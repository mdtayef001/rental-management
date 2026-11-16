"""Products, stock and customers.

`TenantViewSet` is where tenant isolation actually happens: every queryset in this file and
in rentals starts from `business=request.user.business`, so no view can forget.
"""

from django.db.models import BooleanField, Count, ExpressionWrapper, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User, log
from apps.accounts.permissions import LEADS, TEAM, IsTenantMember, ManagerNeedsPermission
from apps.api import Pagination
from apps.rentals.expressions import BALANCE, MONEY, UNITS_OUT

from . import services
from .models import Customer, CustomerRate, Product, StockMovement
from .serializers import (
    CustomerRateSerializer,
    CustomerRateWriteSerializer,
    CustomerSerializer,
    CustomerWriteSerializer,
    LookupSerializer,
    ProductSerializer,
    ProductWriteSerializer,
    StockAdjustSerializer,
    StockMovementSerializer,
)




class TenantViewSet(viewsets.GenericViewSet):
    """Base for every viewset that serves tenant data.

    Subclasses say which model they serve; this class makes sure the queryset can only ever
    contain the caller's own business's rows, and gives them the small helpers they all need.
    """

    permission_classes = [IsAuthenticated, IsTenantMember, ManagerNeedsPermission]
    pagination_class = Pagination
    model = None
    search_fields = ()
    allowed_roles = LEADS

    def get_queryset(self):
        return self.model.objects.filter(business=self.request.user.business)

    def search(self, qs):
        """?search= against the viewset's `search_fields`."""
        text = self.request.query_params.get("search", "").strip()
        if not text or not self.search_fields:
            return qs
        clause = Q()
        for field in self.search_fields:
            clause |= Q(**{f"{field}__icontains": text})
        return qs.filter(clause)

    def id_param(self, name):
        """A numeric query parameter, or None. Anything else is ignored rather than erroring,
        so a stale link never shows a 500."""
        value = self.request.query_params.get(name, "")
        return int(value) if value.isdigit() else None



class ProductViewSet(TenantViewSet, viewsets.ModelViewSet):
    """The catalogue. Readable by the whole team, changed by leads (or staff the owner allows)."""

    model = Product
    serializer_class = ProductSerializer
    search_fields = ("name", "sku", "barcode", "category")
    allowed_roles = TEAM
    manager_permission = "managerProducts"

    def get_serializer_class(self):
        return ProductWriteSerializer if self.action in ("create", "update", "partial_update") else ProductSerializer

    def get_queryset(self):
        """One page of products with how many are out on rent.

        A subquery rather than a join, so a product's several rental lines can't multiply
        its row.
        """
        from apps.rentals.models import Rental, RentalItem

        business = self.request.user.business
        out_on_rent = (
            RentalItem.objects.filter(product=OuterRef("pk"), rental__status__in=Rental.OPEN)
            .values("product")
            .annotate(n=Sum(UNITS_OUT))
            .values("n")
        )
        return (
            Product.objects.filter(business=business)
            .annotate(
                out_on_rent=Coalesce(Subquery(out_on_rent, output_field=IntegerField()), Value(0)),
                is_low=ExpressionWrapper(services.low_stock_q(business), output_field=BooleanField()),
            )
        )

    def filter_queryset(self, qs):
        qs = self.search(qs)
        params = self.request.query_params
        # Archived products leave the lists, not the system: one opened by its id — from an
        # old receipt, a bill, a report — is still there to read.
        if self.action == "list":
            qs = qs.filter(archived_at__isnull=params.get("archived") != "1")
        if params.get("rentable") == "1":
            qs = qs.filter(rentable=True)
        category = params.get("category", "").strip()
        if category:
            qs = qs.filter(category__iexact=category)
        if params.get("in_stock") == "1":
            qs = qs.filter(quantity__gt=0)
        if params.get("low_stock") == "1":
            qs = qs.filter(is_low=True)
        order = params.get("sort", "")
        return qs.order_by({"name": "name", "stock": "quantity", "newest": "-created_at"}.get(order, "-created_at"))

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        user = request.user
        if user.role == User.Role.STAFF and not user.business.permission_on("staffCreateProducts"):
            raise PermissionDenied("Only the owner or a manager can change products.")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = services.create_product(user=request.user, **serializer.validated_data)
        return Response(ProductSerializer(self.get_queryset().get(pk=product.pk)).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        product = serializer.save()
        log(self.request.user, "Product changed", f"{product.name} ({product.sku})")

    def destroy(self, request, *args, **kwargs):
        """Deletes an unused product, archives one with history. See `delete_product`."""
        archived = services.delete_product(user=request.user, product=self.get_object())
        return Response({"archived": archived})

    @action(detail=False)
    def categories(self, request):
        """The categories in use, for filter dropdowns. Small and cacheable."""
        rows = (
            Product.objects.filter(business=request.user.business, archived_at__isnull=True)
            .exclude(category="")
            .values_list("category", flat=True)
            .distinct()
            .order_by("category")
        )
        return Response(list(rows))

    @action(detail=False)
    def units(self, request):
        """The units in use ("pcs", "set"), offered when adding a product so the same thing
        is not spelt three ways."""
        rows = (
            Product.objects.filter(business=request.user.business)
            .exclude(unit="")
            .values_list("unit", flat=True)
            .distinct()
            .order_by("unit")
        )
        return Response(list(rows))

    @action(detail=False)
    def lookup(self, request):
        """Resolve one scanned or typed code to a product. The scanner's endpoint.

        `?code=` for a scan, `?search=` to look one up by name. `?rentableOnly=1` keeps the
        rent-out screen from offering something that isn't for rent.
        """
        business = request.user.business
        rentable_only = request.query_params.get("rentable_only") == "1"
        code = request.query_params.get("code", "").strip()

        if code:
            product = services.find_by_code(business, code, rentable_only=rentable_only)
            if not product:
                # 404 with a usable message: the scan screen shows it and offers a search.
                raise NotFound(f"No product has the code “{code}”.")
            return Response(LookupSerializer.of(product))

        text = request.query_params.get("search", "").strip()
        products = services.search_products(business, text, rentable_only=rentable_only)
        return Response([LookupSerializer.of(p) for p in products])


class StockViewSet(TenantViewSet):
    """The stock page's totals, the corrections staff make, and the ledger behind them.

    Stock itself is `Product.quantity`, listed through the products endpoint.
    """

    model = Product
    allowed_roles = TEAM

    def get_queryset(self):
        return Product.objects.filter(business=self.request.user.business, archived_at__isnull=True)

    @action(detail=False)
    def summary(self, request):
        """Totals for the stock page header, all in one query."""
        qs = self.get_queryset()
        totals = qs.aggregate(
            units=Coalesce(Sum("quantity"), Value(0)),
            lines=Count("id"),
            low=Count("id", filter=services.low_stock_q(request.user.business)),
        )
        return Response({"units": totals["units"], "lines": totals["lines"], "lowStock": totals["low"]})

    @action(detail=False, methods=["post"])
    def adjust(self, request):
        """Correct a shelf count. Needs the `canAddStock` right."""
        if not request.user.may_add_stock:
            raise PermissionDenied("You haven't been given permission to change stock.")
        serializer = StockAdjustSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        services.adjust_stock(
            user=request.user,
            product=data["product"],
            quantity=data["quantity"],
            reason=data["reason"],
            note=data["note"],
        )
        return Response(ProductSerializer(ProductViewSet(request=request).get_queryset().get(pk=data["product"].pk)).data)

    @action(detail=False)
    def movements(self, request):
        """The stock ledger: every change, with its reason and who made it."""
        qs = StockMovement.objects.filter(business=request.user.business).select_related("product", "by")
        product = self.id_param("product")
        if product:
            qs = qs.filter(product_id=product)
        reason = request.query_params.get("reason", "")
        if reason in StockMovement.Reason.values:
            qs = qs.filter(reason=reason)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(StockMovementSerializer(page, many=True).data)
        return Response(StockMovementSerializer(qs[:200], many=True).data)


class CustomerViewSet(TenantViewSet, viewsets.ModelViewSet):
    """Who the business rents to. The whole team can read and add; leads can edit and delete."""

    model = Customer
    serializer_class = CustomerSerializer
    search_fields = ("name", "company", "phone", "email", "id_number")
    allowed_roles = TEAM
    manager_permission = "managerCustomers"

    def get_serializer_class(self):
        return CustomerWriteSerializer if self.action in ("create", "update", "partial_update") else CustomerSerializer

    def get_queryset(self):
        qs = Customer.objects.filter(business=self.request.user.business)
        if self.request.query_params.get("stats") == "1" or self.action == "retrieve":
            qs = self.with_stats(qs)
        return qs

    def with_stats(self, qs):
        """How many rentals they've had, how many are open, and what they still owe.

        Each is a subquery so the three can't multiply each other's rows.
        """
        from apps.rentals.models import Rental

        rentals = Rental.objects.filter(customer=OuterRef("pk"))
        open_rentals = rentals.filter(status__in=Rental.OPEN)
        return qs.annotate(
            rental_count=Coalesce(
                Subquery(rentals.values("customer").annotate(n=Count("id")).values("n"), output_field=IntegerField()), Value(0)
            ),
            open_rental_count=Coalesce(
                Subquery(open_rentals.values("customer").annotate(n=Count("id")).values("n"), output_field=IntegerField()), Value(0)
            ),
            balance_due=Coalesce(
                Subquery(
                    rentals.values("customer").annotate(n=Sum(BALANCE)).values("n")
                ),
                Value(0),
                output_field=MONEY,
            ),
        )

    def filter_queryset(self, qs):
        qs = self.search(qs)
        params = self.request.query_params
        # Archived customers leave the list and the pickers, but still open by id.
        if self.action == "list":
            qs = qs.filter(archived_at__isnull=params.get("archived") != "1")
        if params.get("blocked") == "1":
            qs = qs.filter(blocked=True)
        if params.get("has_open_rentals") == "1":
            from apps.rentals.models import Rental

            qs = qs.filter(rentals__status__in=Rental.OPEN).distinct()
        return qs

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in ("GET", "HEAD", "OPTIONS", "POST"):
            # Staff add customers as part of renting out; that's the point of the screen.
            return
        if request.user.role == User.Role.STAFF:
            raise PermissionDenied("Only the owner or a manager can change or remove customers.")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        customer = services.create_customer(user=request.user, **serializer.validated_data)
        return Response(CustomerSerializer(customer).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        customer = serializer.save()
        log(self.request.user, "Customer changed", customer.name)

    def destroy(self, request, *args, **kwargs):
        """Deletes a customer who never rented, archives one who has. See `delete_customer`."""
        archived = services.delete_customer(user=request.user, customer=self.get_object())
        return Response({"archived": archived})

    @action(detail=True, methods=["get", "put"])
    def rates(self, request, pk=None):
        """The prices agreed with this customer.

        GET lists them — the rent-out screen reads this to start each line at the right
        price. PUT sets one, and a null rate puts the customer back on the product's own.
        Staff can read but not change them (see `check_permissions`).
        """
        customer = self.get_object()
        if request.method == "PUT":
            serializer = CustomerRateWriteSerializer(data=request.data, context={"request": request})
            serializer.is_valid(raise_exception=True)
            services.set_customer_rate(user=request.user, customer=customer, **serializer.validated_data)
        rates = CustomerRate.objects.filter(customer=customer).select_related("product")[: Pagination.max_page_size]
        return Response(CustomerRateSerializer(rates, many=True).data)
