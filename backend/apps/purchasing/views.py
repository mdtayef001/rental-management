"""The purchasing API. Behind the `purchases` module switch and the owner's manager permission."""

from decimal import Decimal

from django.db.models import Count, DecimalField, F, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import LEADS
from apps.catalog.views import TenantViewSet

from . import services
from .models import Purchase, Supplier, SupplierPayment, SupplierReturn
from .serializers import (
    PurchaseCreateSerializer,
    PurchaseSerializer,
    SettleReturnSerializer,
    SupplierPaymentCreateSerializer,
    SupplierPaymentSerializer,
    SupplierReturnCreateSerializer,
    SupplierReturnSerializer,
    SupplierSerializer,
    SupplierWriteSerializer,
)

MONEY = DecimalField(max_digits=14, decimal_places=2)


class PurchasingViewSet(TenantViewSet):
    """Shared gate: purchasing is a module the owner can switch off, and a permission a
    manager needs before they can see what the business pays for its stock."""

    allowed_roles = LEADS
    module = "purchases"
    manager_permission = "managerPurchases"

    def check_permissions(self, request):
        super().check_permissions(request)
        from apps.accounts.models import User
        from rest_framework.exceptions import PermissionDenied

        if request.user.role == User.Role.MANAGER and not request.user.business.permission_on("managerPurchases"):
            raise PermissionDenied("The owner hasn't given managers access to purchasing.")


class SupplierViewSet(PurchasingViewSet, viewsets.ModelViewSet):
    model = Supplier
    serializer_class = SupplierSerializer
    search_fields = ("name", "company", "phone", "email")

    def get_serializer_class(self):
        return SupplierWriteSerializer if self.action in ("create", "update", "partial_update") else SupplierSerializer

    def get_queryset(self):
        qs = Supplier.objects.filter(business=self.request.user.business)
        if self.request.query_params.get("stats") == "1" or self.action == "retrieve":
            purchases = Purchase.objects.filter(supplier=OuterRef("pk"))
            qs = qs.annotate(
                purchase_count=Coalesce(
                    Subquery(purchases.values("supplier").annotate(n=Count("id")).values("n"), output_field=IntegerField()), Value(0)
                ),
                total_bought=Coalesce(
                    Subquery(purchases.values("supplier").annotate(n=Sum("total")).values("n")), Value(0), output_field=MONEY
                ),
                balance=Coalesce(
                    Subquery(
                        purchases.values("supplier").annotate(n=Sum(F("total") - F("paid_amount"))).values("n")
                    ),
                    Value(0),
                    output_field=MONEY,
                ),
            )
        return qs

    def filter_queryset(self, qs):
        qs = self.search(qs)
        if self.request.query_params.get("owing") == "1":
            qs = qs.filter(balance__gt=0)
        return qs

    def perform_create(self, serializer):
        from apps.accounts.models import log

        supplier = serializer.save(business=self.request.user.business, created_by=self.request.user)
        log(self.request.user, "Supplier added", supplier.name)

    def perform_update(self, serializer):
        from apps.accounts.models import log

        supplier = serializer.save()
        log(self.request.user, "Supplier changed", supplier.name)

    def destroy(self, request, *args, **kwargs):
        services.delete_supplier(user=request.user, supplier=self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True)
    def statement(self, request, pk=None):
        """Every bill and payment with this supplier, newest first, with the running balance.

        Built in one pass over two small querysets rather than a query per row.
        """
        supplier = self.get_object()
        bills = [
            {
                "kind": "purchase",
                "id": str(p.id),
                "code": p.code,
                "at": p.purchased_at,
                "amount": p.total,
                "note": p.reference or p.note,
            }
            for p in Purchase.objects.filter(supplier=supplier).only("id", "number", "purchased_at", "total", "reference", "note")
        ]
        payments = [
            {
                "kind": "payment",
                "id": str(sp.id),
                "code": sp.code,
                "at": sp.paid_at,
                "amount": -sp.amount,
                "note": sp.get_method_display() if sp.method else sp.note,
            }
            for sp in SupplierPayment.objects.filter(supplier=supplier).only("id", "number", "paid_at", "amount", "method", "note")
        ]
        rows = sorted(bills + payments, key=lambda r: r["at"])
        running = Decimal("0.00")
        for row in rows:
            running += row["amount"]
            row["balance"] = running
        rows.reverse()
        return Response({"supplier": SupplierSerializer(supplier).data, "rows": rows, "balance": running})


class PurchaseViewSet(PurchasingViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    model = Purchase
    serializer_class = PurchaseSerializer
    search_fields = ("supplier__name", "reference", "items__product_name")

    def get_queryset(self):
        return (
            Purchase.objects.filter(business=self.request.user.business)
            .select_related("supplier", "branch", "created_by")
            .prefetch_related("items")
        )

    def filter_queryset(self, qs):
        qs = self.search(qs).distinct() if self.request.query_params.get("search") else qs
        params = self.request.query_params
        supplier = self.id_param("supplier")
        if supplier:
            qs = qs.filter(supplier_id=supplier)
        state = params.get("paymentStatus", "")
        if state == "unpaid":
            qs = qs.filter(paid_amount=0, total__gt=0)
        elif state == "partly_paid":
            qs = qs.filter(paid_amount__gt=0, paid_amount__lt=F("total"))
        elif state == "paid":
            qs = qs.filter(paid_amount__gte=F("total"))
        elif state == "owing":
            qs = qs.filter(paid_amount__lt=F("total"))
        since, until = params.get("from", ""), params.get("to", "")
        if since:
            qs = qs.filter(purchased_at__date__gte=since)
        if until:
            qs = qs.filter(purchased_at__date__lte=until)
        return qs.order_by("-purchased_at", "-id")

    def create(self, request, *args, **kwargs):
        serializer = PurchaseCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        purchase = services.create_purchase(user=request.user, **serializer.validated_data)
        return Response(PurchaseSerializer(self.get_queryset().get(pk=purchase.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=False)
    def summary(self, request):
        qs = self.filter_queryset(self.get_queryset())
        return Response(
            qs.aggregate(
                count=Count("id"),
                total=Coalesce(Sum("total"), Value(0), output_field=MONEY),
                due=Coalesce(Sum(F("total") - F("paid_amount")), Value(0), output_field=MONEY),
            )
        )

    @action(detail=False, methods=["post"], url_path="returns")
    def create_return(self, request):
        """Send part of a purchase back to the supplier."""
        serializer = SupplierReturnCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        supplier_return = services.create_supplier_return(user=request.user, **serializer.validated_data)
        return Response(SupplierReturnSerializer(supplier_return).data, status=status.HTTP_201_CREATED)

    @action(detail=False, url_path="returns-list")
    def returns_list(self, request):
        qs = SupplierReturn.objects.filter(business=request.user.business).select_related("purchase", "supplier")
        state = request.query_params.get("status", "")
        if state in SupplierReturn.Status.values:
            qs = qs.filter(status=state)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(SupplierReturnSerializer(page, many=True).data)
        return Response(SupplierReturnSerializer(qs[:200], many=True).data)

    @action(detail=False, methods=["post"], url_path=r"returns/(?P<return_id>[^/.]+)/settle")
    def settle(self, request, return_id=None):
        supplier_return = SupplierReturn.objects.filter(business=request.user.business, pk=return_id).first()
        if supplier_return is None:
            from rest_framework.exceptions import NotFound

            raise NotFound("That return isn't here any more.")
        serializer = SettleReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        settled = services.settle_return(user=request.user, supplier_return=supplier_return, **serializer.validated_data)
        return Response(SupplierReturnSerializer(settled).data)

    @action(detail=False, methods=["get", "post"], url_path="payments")
    def payments(self, request):
        """List payments out, or record one."""
        if request.method == "POST":
            serializer = SupplierPaymentCreateSerializer(data=request.data, context={"request": request})
            serializer.is_valid(raise_exception=True)
            payment = services.pay_supplier(user=request.user, **serializer.validated_data)
            return Response(
                SupplierPaymentSerializer(SupplierPayment.objects.prefetch_related("allocations__purchase").get(pk=payment.pk)).data,
                status=status.HTTP_201_CREATED,
            )

        qs = (
            SupplierPayment.objects.filter(business=request.user.business)
            .select_related("supplier", "created_by")
            .prefetch_related("allocations__purchase")
        )
        supplier = self.id_param("supplier")
        if supplier:
            qs = qs.filter(supplier_id=supplier)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(SupplierPaymentSerializer(page, many=True).data)
        return Response(SupplierPaymentSerializer(qs[:200], many=True).data)

    @action(detail=False, url_path="payments-summary")
    def payments_summary(self, request):
        """What's owed to all suppliers, and how much of it is past its due date."""
        qs = Purchase.objects.filter(business=request.user.business).filter(paid_amount__lt=F("total"))
        from django.utils import timezone

        return Response(
            qs.aggregate(
                owed=Coalesce(Sum(F("total") - F("paid_amount")), Value(0), output_field=MONEY),
                overdue=Coalesce(
                    Sum(F("total") - F("paid_amount"), filter=Q(due_date__lt=timezone.localdate())), Value(0), output_field=MONEY
                ),
                supplier_count=Count("supplier", distinct=True),
            )
        )
