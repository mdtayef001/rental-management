"""The rental API: rent out, find what's coming back, take returns, print receipts."""

from datetime import timedelta

from django.db.models import Count, DecimalField, F, IntegerField, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import LEADS, TEAM, IsTenantMember
from apps.api import Pagination
from apps.catalog.views import TenantViewSet
from apps.catalog.models import Customer

from . import services, statements
from .models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine
from .services import ZERO
from .serializers import (
    CancelSerializer,
    PaymentCreateSerializer,
    QuoteSerializer,
    RentalCreateSerializer,
    RentalListSerializer,
    RentalReturnSerializer,
    RentalSerializer,
    ResolveReturnSerializer,
    ReturnCreateSerializer,
)

MONEY = DecimalField(max_digits=14, decimal_places=2)


class RentalViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    """Rentals. The whole team can use these; staff need the `canRent` right."""

    model = Rental
    serializer_class = RentalListSerializer
    search_fields = ("customer__name", "customer__phone", "customer__company", "items__product_name", "items__product_sku")
    allowed_roles = TEAM
    module = "rentals"

    def get_queryset(self):
        qs = (
            Rental.objects.filter(business=self.request.user.business)
            .select_related("customer", "branch")
            .annotate(
                item_count=Count("items", distinct=True),
                units_out=Coalesce(
                    Sum(F("items__quantity") - F("items__quantity_returned") - F("items__quantity_lost")),
                    Value(0),
                    output_field=IntegerField(),
                ),
            )
        )
        if self.action == "retrieve":
            qs = qs.prefetch_related("items", "returns__lines__item", "payments__by")
        return self.scope_to_branches(qs)

    def get_serializer_class(self):
        return RentalSerializer if self.action == "retrieve" else RentalListSerializer

    def filter_queryset(self, qs):
        qs = self.search(qs).distinct() if self.request.query_params.get("search") else qs
        params = self.request.query_params

        state = params.get("status", "")
        if state == "open":
            qs = qs.filter(status__in=Rental.OPEN)
        elif state == "overdue":
            qs = qs.filter(Rental.overdue_q())
        elif state == "due_today":
            start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
            qs = qs.filter(status__in=Rental.OPEN, due_at__gte=start, due_at__lt=start + timedelta(days=1))
        elif state == "unpaid":
            qs = qs.annotate(
                owing=F("rent_total") + F("late_fee") + F("damage_fee") - F("discount") - F("paid_amount")
            ).filter(owing__gt=0)
        elif state in Rental.Status.values:
            qs = qs.filter(status=state)

        customer = self.id_param("customer")
        if customer:
            qs = qs.filter(customer_id=customer)
        branch = self.id_param("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        product = self.id_param("product")
        if product:
            qs = qs.filter(items__product_id=product).distinct()

        since, until = params.get("from", ""), params.get("to", "")
        if since:
            qs = qs.filter(started_at__date__gte=since)
        if until:
            qs = qs.filter(started_at__date__lte=until)

        # Staff see only their own rentals unless the owner lets them see the shop's.
        if self.request.user.role == User.Role.STAFF and params.get("mine") == "1":
            qs = qs.filter(created_by=self.request.user)

        sort = params.get("sort", "")
        if sort == "due":
            # Soonest due first, and the ones with no return date after everything that has
            # one. Said outright, because databases disagree on where an empty date sorts,
            # and a list read a page at a time has to come in the same order every time.
            return qs.order_by(F("due_at").asc(nulls_last=True), "id")
        return qs.order_by("started_at" if sort == "oldest" else "-started_at")

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        if not request.user.may_rent:
            raise PermissionDenied("You haven't been given permission to rent items out.")

    # ---------- Renting out ----------

    def create(self, request, *args, **kwargs):
        serializer = RentalCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        rental = services.create_rental(user=request.user, **serializer.validated_data)
        return Response(self.full(rental), status=status.HTTP_201_CREATED)

    def full(self, rental):
        """Re-read the rental with everything the detail serializer needs."""
        return RentalSerializer(self.get_queryset_for_detail(rental.pk)).data

    def get_queryset_for_detail(self, pk):
        return (
            Rental.objects.filter(business=self.request.user.business, pk=pk)
            .select_related("customer", "branch", "created_by")
            .prefetch_related("items", "returns__lines__item", "payments__by")
            .annotate(
                item_count=Count("items", distinct=True),
                units_out=Coalesce(
                    Sum(F("items__quantity") - F("items__quantity_returned") - F("items__quantity_lost")),
                    Value(0),
                    output_field=IntegerField(),
                ),
            )
            .get()
        )

    # ---------- Returning ----------

    @action(detail=False, methods=["post"], url_path="resolve-return")
    def resolve_return(self, request):
        """"What is this person bringing back?"

        One endpoint behind the return scanner. A scanned product barcode, a rental's QR
        code, or a chosen customer all come back in the same shape — `matches` with enough
        on each to tell two rentals of the same product apart, and `exact` set when there is
        only one, so the usual case needs no extra tap.
        """
        if not request.user.may_take_returns:
            raise PermissionDenied("You haven't been given permission to take returns.")
        serializer = ResolveReturnSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        rental = None
        if data.get("rental"):
            rental = self.get_queryset().filter(pk=data["rental"]).first() if str(data["rental"]).isdigit() else None
            if rental is None:
                raise NotFound("That rental isn't here any more.")

        result = services.resolve_return(
            request.user.business,
            code=data.get("code", ""),
            customer=data.get("customer"),
            rental=rental,
            branch_ids=self.branches_allowed(),
        )
        return Response(result)

    @action(detail=True, methods=["post"], url_path="return")
    def take_return(self, request, pk=None):
        """Take some or all of this rental's items back."""
        if not request.user.may_take_returns:
            raise PermissionDenied("You haven't been given permission to take returns.")
        rental = self.get_object()
        serializer = ReturnCreateSerializer(data=request.data, context={"request": request, "rental": rental})
        serializer.is_valid(raise_exception=True)
        rental_return = services.take_return(user=request.user, rental=rental, **serializer.validated_data)
        return Response(
            {
                "return": RentalReturnSerializer(rental_return).data,
                "rental": self.full(rental),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def payment(self, request, pk=None):
        rental = self.get_object()
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.add_payment(user=request.user, rental=rental, **serializer.validated_data)
        return Response(self.full(rental))

    @action(detail=True, methods=["post"])
    def refund(self, request, pk=None):
        """Give back money the customer paid in advance and didn't use."""
        if not request.user.may_take_returns:
            raise PermissionDenied("You haven't been given permission to give money back.")
        rental = self.get_object()
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.refund(user=request.user, rental=rental, **serializer.validated_data)
        return Response(self.full(rental))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Undo a rental entered by mistake. Leads only — staff shouldn't erase their own."""
        if request.user.role == User.Role.STAFF:
            raise PermissionDenied("Ask the owner or a manager to cancel a rental.")
        rental = self.get_object()
        serializer = CancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.cancel_rental(user=request.user, rental=rental, reason=serializer.validated_data["reason"])
        return Response(self.full(rental))

    # ---------- Totals ----------

    @action(detail=False)
    def summary(self, request):
        """The rental page header and dashboard tiles, in two queries.

        Computed in the database on purpose: a shop with 40,000 rentals must not load them
        into Python to count how many are overdue.
        """
        qs = self.scope_to_branches(Rental.objects.filter(business=request.user.business))
        now = timezone.now()
        start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = start.replace(day=1)

        counts = qs.aggregate(
            open=Count("id", filter=Q(status__in=Rental.OPEN)),
            overdue=Count("id", filter=Rental.overdue_q()),
            due_today=Count("id", filter=Q(status__in=Rental.OPEN, due_at__gte=start, due_at__lt=start + timedelta(days=1))),
            returned_today=Count("id", filter=Q(status=Rental.Status.RETURNED, returned_at__gte=start)),
        )
        # Two figures, not one net sum: a customer who has paid in advance must not hide
        # another who owes. `owed` is what is still to collect; `advances` is money the shop
        # is holding against rent it hasn't charged yet.
        balance = F("rent_total") + F("late_fee") + F("damage_fee") - F("discount") - F("paid_amount")
        money = qs.exclude(status=Rental.Status.CANCELLED).annotate(owing=balance).aggregate(
            owed=Coalesce(Sum("owing", filter=Q(owing__gt=0)), Value(0), output_field=MONEY),
            advances=Coalesce(Sum(-F("owing"), filter=Q(owing__lt=0)), Value(0), output_field=MONEY),
        )
        counts.update(money)
        # Rent is *earned* when the items come back, because that is when the length of the
        # hire — and so the price — is finally known. Summing the rentals that happened to
        # start this month would credit October's money to October even though it was only
        # charged in November, so this counts the returns instead.
        earned = RentalReturn.objects.filter(business=request.user.business, at__gte=month_start).aggregate(
            rent=Coalesce(Sum("rent_total"), Value(0), output_field=MONEY),
            fees=Coalesce(Sum(F("late_fee") + F("damage_fee") - F("discount")), Value(0), output_field=MONEY),
        )
        counts["revenue_month"] = earned["rent"] + earned["fees"]
        units_out = (
            RentalItem.objects.filter(rental__business=request.user.business, rental__status__in=Rental.OPEN)
            .aggregate(n=Coalesce(Sum(F("quantity") - F("quantity_returned") - F("quantity_lost")), Value(0), output_field=IntegerField()))
        )["n"]
        # What has come back today, counted from the take-backs themselves. A rental only
        # reads as "returned" once its last unit is in, so counting rentals would show
        # nothing on the day 60 of 100 machines came back.
        back = RentalReturn.objects.filter(business=request.user.business, at__gte=start).aggregate(
            returns=Count("id", distinct=True),
            units=Coalesce(
                Sum("lines__quantity", filter=~Q(lines__condition=RentalReturnLine.Condition.LOST)),
                Value(0),
                output_field=IntegerField(),
            ),
        )
        return Response(
            {**counts, "unitsOut": units_out, "returnsToday": back["returns"], "unitsReturnedToday": back["units"]}
        )

    @action(detail=False, methods=["post"])
    def quote(self, request):
        """Price a line before it's saved. The same arithmetic the server charges at return."""
        serializer = QuoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        total = RentalItem.quote(data["plan"], data["rate"], data["days"], data["quantity"], data["holidays"])
        return Response({"total": total})


class RentalReturnViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    """The returns ledger: every act of taking items back."""

    model = RentalReturn
    serializer_class = RentalReturnSerializer
    search_fields = ("rental__customer__name", "lines__item__product_name")
    allowed_roles = TEAM
    module = "rentals"

    def get_queryset(self):
        return (
            RentalReturn.objects.filter(business=self.request.user.business)
            .select_related("rental", "rental__customer", "by")
            .prefetch_related("lines__item")
        )

    def filter_queryset(self, qs):
        qs = self.search(qs).distinct() if self.request.query_params.get("search") else qs
        rental = self.id_param("rental")
        if rental:
            qs = qs.filter(rental_id=rental)
        since, until = self.request.query_params.get("from", ""), self.request.query_params.get("to", "")
        if since:
            qs = qs.filter(at__date__gte=since)
        if until:
            qs = qs.filter(at__date__lte=until)
        return qs.order_by("-at", "-id")


class PublicReceiptView(APIView):
    """The receipt a customer opens from a link or a QR code on their printed slip.

    No login: the token is the credential, which is why it's 16 random bytes rather than the
    rental number. It shows what they rented and what they paid — never the business's cost,
    profit, other customers or anything else about the shop.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        rental = (
            Rental.objects.filter(token=token)
            .select_related("business", "customer", "branch")
            .prefetch_related("items", "returns__lines__item")
            .first()
        )
        if rental is None:
            rental_return = (
                RentalReturn.objects.filter(token=token)
                .select_related("business", "rental", "rental__customer", "rental__branch")
                .prefetch_related("lines__item")
                .first()
            )
            if rental_return is None:
                raise NotFound("This receipt link is no longer valid.")
            return Response(self.body(rental_return.rental, highlight=rental_return))
        return Response(self.body(rental))

    def body(self, rental, highlight=None):
        business = rental.business
        payments = list(rental.payments.all())
        return {
            "business": {
                "name": business.name,
                "phone": business.phone,
                "address": business.address,
                "currency": business.settings.get("currency", "BDT"),
                "receiptNote": business.receipt_note,
                # So the receipt can show what an overdue rental is running up.
                "lateFeeMultiplier": float(business.rental_setting("lateFeeMultiplier", 1.0) or 0),
                "logoVersion": business.logo_version,
            },
            "branch": {"name": rental.branch.name, "phone": rental.branch.phone, "address": rental.branch.address}
            if rental.branch
            else None,
            "rental": {
                "code": rental.code,
                "status": rental.status,
                "customerName": rental.customer.name if rental.customer else "Walk-in",
                "startedAt": rental.started_at,
                "dueAt": rental.due_at,
                "returnedAt": rental.returned_at,
                "rentTotal": rental.rent_total,
                "lateFee": rental.late_fee,
                "damageFee": rental.damage_fee,
                "discount": rental.discount,
                # Paid before anything was charged, and anything since handed back.
                "advancePaid": sum((p.amount for p in payments if p.kind == RentalPayment.Kind.ADVANCE), ZERO),
                "refunded": -sum((p.amount for p in payments if p.kind == RentalPayment.Kind.REFUND), ZERO),
                "paidAmount": rental.paid_amount,
                "charges": rental.charges,
                "balance": rental.balance,
                "notes": rental.notes,
            },
            "items": [
                {
                    "productName": item.product_name,
                    "quantity": item.quantity,
                    "quantityReturned": item.quantity_returned,
                    "quantityLost": item.quantity_lost,
                    "plan": item.plan,
                    "rate": item.rate,
                    "daysOut": item.days_out,
                    "lineTotal": item.line_total,
                }
                for item in rental.items.all()
            ],
            "returns": [
                {
                    "code": r.code,
                    "at": r.at,
                    "rentTotal": r.rent_total,
                    "lateFee": r.late_fee,
                    "damageFee": r.damage_fee,
                    "discount": r.discount,
                    "paidAmount": r.paid_amount,
                    "refunded": r.refunded,
                    "paymentMethod": r.payment_method,
                    "lines": [
                        {
                            "productName": line.item.product_name,
                            "quantity": line.quantity,
                            "condition": line.condition,
                            "daysOut": line.days_out,
                            "rentAmount": line.rent_amount,
                            "lateFee": line.late_fee,
                            "damageFee": line.damage_fee,
                        }
                        for line in r.lines.all()
                    ],
                }
                for r in rental.returns.all()
            ],
            # Which return the customer followed the link for, so that one can be highlighted.
            "highlightReturn": highlight.code if highlight else None,
        }


class PublicReceiptLogoView(APIView):
    """The shop's logo for the customer's copy of a receipt.

    Reached with the same token as the receipt itself, so it gives away nothing the receipt
    link doesn't already show.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        from apps.accounts.views import logo_response

        rental = Rental.objects.filter(token=token).select_related("business").first()
        if rental is None:
            taken = RentalReturn.objects.filter(token=token).select_related("business").first()
            if taken is None:
                raise NotFound("This receipt link is no longer valid.")
            return logo_response(taken.business)
        return logo_response(rental.business)


# ---------- Bills ----------


class BillView(APIView):
    """Shared gate for bills: owners and managers, in a business that rents.

    A bill puts everything one customer owes on a single sheet, across every branch, so it
    is kept to the people who already see the whole shop's money.
    """

    permission_classes = [IsAuthenticated, IsTenantMember]
    allowed_roles = LEADS
    module = "rentals"

    @property
    def business(self):
        return self.request.user.business

    @property
    def period(self):
        return statements.parse_period(self.request.query_params)

    def customer(self, customer_id):
        customer = Customer.objects.filter(business=self.business, pk=customer_id).first()
        if customer is None:
            raise NotFound("That customer isn't here any more.")
        return customer


class BillListView(BillView):
    """Month end: every customer with something to bill, and how much."""

    def get(self, request):
        rng = self.period
        rows = statements.period_bills(self.business, rng, request.query_params.get("search", ""))
        totals = {
            "customers": len(rows),
            "charges": sum((r["charges"] for r in rows), statements.ZERO),
            "paid": sum((r["paid"] for r in rows), statements.ZERO),
            "units_out": sum(r["units_out"] for r in rows),
        }
        paginator = Pagination()
        page = paginator.paginate_queryset(rows, request)
        head = {**rng.as_json(), "kind": statements.period_kind(rng), "label": statements.period_label(rng), "totals": totals}
        if page is None:
            return Response({**head, "count": len(rows), "page": 1, "results": rows[: Pagination.max_page_size]})
        return Response({**head, "count": paginator.page.paginator.count, "page": paginator.page.number, "results": page})


class BillDetailView(BillView):
    """One customer's bill for the period, as the screen shows it."""

    def get(self, request, customer_id):
        return Response(statements.build_statement(self.business, self.customer(customer_id), self.period))


class BillPdfView(BillView):
    """The same bill as a PDF file to send."""

    def get(self, request, customer_id):
        from django.http import HttpResponse

        from . import bill_pdf

        statement = statements.build_statement(self.business, self.customer(customer_id), self.period)
        response = HttpResponse(
            bill_pdf.render(statement, logo=bill_pdf.logo_of(self.business)), content_type="application/pdf"
        )
        response["Content-Disposition"] = f'attachment; filename="{bill_pdf.filename(statement)}"'
        # Nothing about a customer's account should sit in a shared cache.
        response["Cache-Control"] = "no-store"
        return response


class BillPaymentView(BillView):
    """One payment against everything a customer owes, oldest rental first."""

    def post(self, request, customer_id):
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        paid = statements.receive_payment(
            user=request.user,
            customer=self.customer(customer_id),
            amount=data["amount"],
            method=data["method"],
            reference=data["reference"],
            note=data["note"],
        )
        return Response({"payments": paid}, status=status.HTTP_201_CREATED)
