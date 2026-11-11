"""What the shop earned, what moved, and who owes money.

Everything here is read-only and adds up in the database. Reports are the one screen an
owner will wait a moment for, but they must still never pull tens of thousands of rows into
Python to total them, so every figure is an aggregate query and the CSV export walks the
rows with an iterator instead of building a list.

One rule decides where each number comes from, and it is the only subtle thing in the file:

    Rent is *earned at return*, not at rent-out.

The price of a hire depends on how long the items were actually out, so it isn't known
until they come back. "Revenue" therefore totals `RentalReturn` rows by the date of the
return. Counts of activity — rentals started, units sent out — total `Rental` rows by the
date they started, because that is genuinely when they happened. Mixing the two would
credit a month with money it had not charged yet.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.db.models import Count, DecimalField, F, IntegerField, Max, Min, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDay, TruncMonth, TruncWeek
from django.utils import timezone

from apps.accounts.models import Business
from apps.catalog.models import Customer
from apps.purchasing.models import Purchase
from apps.rentals.models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine

MONEY = DecimalField(max_digits=14, decimal_places=2)
COUNT = IntegerField()

#: What a rental still has to be paid: negative while the customer is ahead.
BALANCE = F("rent_total") + F("late_fee") + F("damage_fee") - F("discount") - F("paid_amount")

#: How many rows a grouped report will return at most. A report is for reading, so the long
#: tail belongs in the CSV export rather than on screen.
TOP_N = 20
MAX_TOP_N = 200

GROUPS = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}


def total(field, filter=None):
    return Coalesce(Sum(field, filter=filter), Value(0), output_field=MONEY)


def units(field, filter=None):
    return Coalesce(Sum(field, filter=filter), Value(0), output_field=COUNT)


# ---------- The date range ----------


@dataclass(frozen=True)
class Range:
    """A half-open range of local time: `start <= x < end`.

    Half-open so that a report "to the 31st" includes everything that happened on the 31st
    without the 1st of the next month leaking in, whatever the time of day.
    """

    start: datetime
    end: datetime
    #: The last day the range covers, which is what people want to see written down.
    last_day: date

    @property
    def days(self):
        return max((self.last_day - self.start.date()).days + 1, 1)

    def as_json(self):
        return {"from": self.start.date().isoformat(), "to": self.last_day.isoformat()}

    def slug(self):
        return f"{self.start.date().isoformat()}_{self.last_day.isoformat()}"


def parse_date(text):
    """A `YYYY-MM-DD` query parameter, or None. Nonsense is ignored rather than raising, so
    a stale bookmark shows this month instead of an error."""
    try:
        return date.fromisoformat((text or "").strip())
    except ValueError:
        return None


def day_start(day):
    """Midnight at the start of `day`, in the shop's own timezone."""
    return timezone.make_aware(datetime.combine(day, time.min))


def parse_range(params, default_days=30):
    """`?from=&to=` as whole local days, defaulting to the last 30 days including today."""
    today = timezone.localdate()
    to = parse_date(params.get("to")) or today
    start = parse_date(params.get("from")) or (to - timedelta(days=default_days - 1))
    if start > to:
        start, to = to, start
    return Range(start=day_start(start), end=day_start(to + timedelta(days=1)), last_day=to)


def group_by(params):
    """`?group=day|week|month`, defaulting to whatever suits the length of the range."""
    group = (params.get("group") or "").strip()
    return group if group in GROUPS else ""


def auto_group(rng):
    """A year of daily rows is unreadable; a fortnight of monthly rows is one bar."""
    if rng.days <= 31:
        return "day"
    return "week" if rng.days <= 120 else "month"


# ---------- Headline figures ----------


def summary(business: Business, rng: Range):
    """The numbers across the top of the reports screen. Six queries, no row loading."""
    returned = RentalReturn.objects.filter(business=business, at__gte=rng.start, at__lt=rng.end)
    earned = returned.aggregate(
        returns=Count("id"),
        rent=total("rent_total"),
        late_fees=total("late_fee"),
        damage_fees=total("damage_fee"),
        discounts=total("discount"),
    )
    revenue = earned["rent"] + earned["late_fees"] + earned["damage_fees"] - earned["discounts"]

    started = Rental.objects.filter(business=business, started_at__gte=rng.start, started_at__lt=rng.end)
    activity = started.aggregate(
        rentals=Count("id"),
        cancelled=Count("id", filter=Q(status=Rental.Status.CANCELLED)),
    )
    sent_out = RentalItem.objects.filter(
        rental__business=business, rental__started_at__gte=rng.start, rental__started_at__lt=rng.end
    ).aggregate(units=units("quantity"), lines=Count("id"))

    came_back = RentalReturnLine.objects.filter(
        rental_return__business=business, rental_return__at__gte=rng.start, rental_return__at__lt=rng.end
    ).aggregate(
        units=units("quantity"),
        lost=units("quantity", filter=Q(condition=RentalReturnLine.Condition.LOST)),
        damaged=units("quantity", filter=Q(condition=RentalReturnLine.Condition.DAMAGED)),
    )

    # Money actually through the till in the range, which is not the same as money earned:
    # an advance is cash in hand before any rent is charged, and a refund is cash out.
    cash = RentalPayment.objects.filter(business=business, at__gte=rng.start, at__lt=rng.end).aggregate(
        collected=total("amount", filter=Q(amount__gt=0)),
        refunded=total("amount", filter=Q(amount__lt=0)),
    )

    # Where things stand right now, which no date range changes: what is still out, what
    # customers owe, and what they have paid in advance that hasn't been charged yet. Owed
    # and advances are kept apart, so one customer's advance never hides another's debt.
    standing = (
        Rental.objects.filter(business=business)
        .exclude(status=Rental.Status.CANCELLED)
        .annotate(owing=BALANCE)
        .aggregate(
            open=Count("id", filter=Q(status__in=Rental.OPEN)),
            overdue=Count("id", filter=Rental.overdue_q()),
            outstanding=total("owing", filter=Q(owing__gt=0)),
            advances_held=total(-F("owing"), filter=Q(owing__lt=0)),
        )
    )
    out_now = RentalItem.objects.filter(rental__business=business, rental__status__in=Rental.OPEN).aggregate(
        units=units(F("quantity") - F("quantity_returned") - F("quantity_lost"))
    )

    bought = Purchase.objects.filter(
        business=business, purchased_at__gte=rng.start, purchased_at__lt=rng.end
    ).aggregate(bills=Count("id"), spent=total("total"))

    return {
        **rng.as_json(),
        "days": rng.days,
        "revenue": revenue,
        "rent": earned["rent"],
        "lateFees": earned["late_fees"],
        "damageFees": earned["damage_fees"],
        "discounts": earned["discounts"],
        "returns": earned["returns"],
        "rentals": activity["rentals"],
        "cancelled": activity["cancelled"],
        "unitsRented": sent_out["units"],
        "lines": sent_out["lines"],
        "unitsReturned": came_back["units"],
        "unitsLost": came_back["lost"],
        "unitsDamaged": came_back["damaged"],
        "collected": cash["collected"],
        "refunded": -cash["refunded"],
        "newCustomers": Customer.objects.filter(
            business=business, created_at__gte=rng.start, created_at__lt=rng.end
        ).count(),
        "openRentals": standing["open"],
        "overdue": standing["overdue"],
        "unitsOut": out_now["units"],
        "outstanding": standing["outstanding"],
        "advancesHeld": standing["advances_held"],
        "purchaseBills": bought["bills"],
        "purchaseSpend": bought["spent"],
    }


# ---------- The grouped reports ----------
#
# Each one returns a list of plain dicts, already camelCased, so the view hands it straight
# back and the CSV writer can walk the same rows.


def revenue_series(business: Business, rng: Range, group=""):
    """Revenue per day, week or month, from the returns that charged it."""
    group = group or auto_group(rng)
    rows = (
        RentalReturn.objects.filter(business=business, at__gte=rng.start, at__lt=rng.end)
        .annotate(period=GROUPS[group]("at"))
        .values("period")
        .annotate(
            returns=Count("id"),
            rent=total("rent_total"),
            late_fees=total("late_fee"),
            damage_fees=total("damage_fee"),
            discounts=total("discount"),
        )
        .order_by("period")
    )
    # What each bucket is made of: who brought what back. A total on its own cannot be
    # checked against anything; a customer and a product code can be.
    lines = (
        RentalReturnLine.objects.filter(
            rental_return__business=business, rental_return__at__gte=rng.start, rental_return__at__lt=rng.end
        )
        .annotate(period=GROUPS[group]("rental_return__at"))
        .values(
            "period",
            "quantity",
            "rent_amount",
            "late_fee",
            "damage_fee",
            customer=F("rental_return__rental__customer__name"),
            rental_number=F("rental_return__rental__number"),
            product=F("item__product_name"),
            sku=F("item__product_sku"),
            barcode=F("item__product__barcode"),
        )
        .order_by("rental_return__at", "id")
    )
    details = {}
    for line in lines:
        details.setdefault(line["period"], []).append(
            {
                "customer": line["customer"] or "Walk-in",
                "rentalCode": f"RN-{line['rental_number']:06d}",
                "product": line["product"],
                "sku": line["sku"] or "",
                "barcode": line["barcode"] or "",
                "units": line["quantity"],
                "amount": line["rent_amount"] + line["late_fee"] + line["damage_fee"],
            }
        )
    return group, [
        {
            "period": timezone.localtime(row["period"]).date().isoformat(),
            "returns": row["returns"],
            "rent": row["rent"],
            "lateFees": row["late_fees"],
            "damageFees": row["damage_fees"],
            "discounts": row["discounts"],
            "revenue": row["rent"] + row["late_fees"] + row["damage_fees"] - row["discounts"],
            "details": details.get(row["period"], []),
        }
        for row in rows
    ]


def top_products(business: Business, rng: Range, limit=TOP_N):
    """Which products earned the most in the range.

    Grouped by the product itself, with the name taken from the most recent line, because
    the name is frozen onto every rental line at rent-out: grouping by the frozen text
    would split a product in two the day it was renamed.
    """
    rows = (
        RentalReturnLine.objects.filter(
            rental_return__business=business, rental_return__at__gte=rng.start, rental_return__at__lt=rng.end
        )
        .values("item__product_id")
        .annotate(
            name=_latest("item__product_name"),
            sku=_latest("item__product_sku"),
            rentals=Count("rental_return__rental_id", distinct=True),
            units=units("quantity"),
            lost=units("quantity", filter=Q(condition=RentalReturnLine.Condition.LOST)),
            damaged=units("quantity", filter=Q(condition=RentalReturnLine.Condition.DAMAGED)),
            rent=total("rent_amount"),
            late_fees=total("late_fee"),
            damage_fees=total("damage_fee"),
        )
        .annotate(revenue=F("rent") + F("late_fees") + F("damage_fees"))
        .order_by("-revenue", "-units")
    )
    return [
        {
            "id": str(row["item__product_id"]) if row["item__product_id"] else None,
            "name": row["name"] or "Deleted product",
            "sku": row["sku"] or "",
            "rentals": row["rentals"],
            "units": row["units"],
            "lost": row["lost"],
            "damaged": row["damaged"],
            "rent": row["rent"],
            "lateFees": row["late_fees"],
            "damageFees": row["damage_fees"],
            "revenue": row["revenue"],
        }
        for row in rows[:limit]
    ]


def top_customers(business: Business, rng: Range, limit=TOP_N):
    """Who spent the most in the range, and what they still owe across every rental."""
    rows = (
        RentalReturn.objects.filter(business=business, at__gte=rng.start, at__lt=rng.end)
        .values("rental__customer_id")
        .annotate(
            name=_latest("rental__customer__name"),
            phone=_latest("rental__customer__phone"),
            rentals=Count("rental_id", distinct=True),
            returns=Count("id"),
            rent=total("rent_total"),
            late_fees=total("late_fee"),
            damage_fees=total("damage_fee"),
            discounts=total("discount"),
        )
        .annotate(revenue=F("rent") + F("late_fees") + F("damage_fees") - F("discounts"))
        .order_by("-revenue", "-rentals")
    )
    rows = list(rows[:limit])

    # One extra query for the balances, rather than one per customer.
    ids = [row["rental__customer_id"] for row in rows if row["rental__customer_id"]]
    owed = {
        row["customer_id"]: row["balance"]
        for row in Rental.objects.filter(business=business, customer_id__in=ids)
        .values("customer_id")
        .annotate(balance=total(F("rent_total") + F("late_fee") + F("damage_fee") - F("discount") - F("paid_amount")))
    }
    return [
        {
            "id": str(row["rental__customer_id"]) if row["rental__customer_id"] else None,
            "name": row["name"] or "Walk-in",
            "phone": row["phone"] or "",
            "rentals": row["rentals"],
            "returns": row["returns"],
            "rent": row["rent"],
            "lateFees": row["late_fees"],
            "damageFees": row["damage_fees"],
            "discounts": row["discounts"],
            "revenue": row["revenue"],
            "outstanding": owed.get(row["rental__customer_id"], 0),
        }
        for row in rows
    ]


def debtors(business: Business, limit=TOP_N):
    """Who owes money right now, most first. Not tied to the date range: a debt is a debt.

    Added up per customer across all their rentals, so someone who paid one rental in
    advance and owes on another is listed for the difference, and not at all if they are
    ahead overall.
    """
    rows = (
        Rental.objects.filter(business=business)
        .exclude(status=Rental.Status.CANCELLED)
        .values("customer_id")
        .annotate(
            name=_latest("customer__name"),
            phone=_latest("customer__phone"),
            rentals=Count("id", filter=Q(status__in=Rental.OPEN)),
            oldest=Min("started_at", filter=Q(status__in=Rental.OPEN)),
            owed=total(BALANCE),
        )
        .filter(owed__gt=0)
        .order_by("-owed")
    )
    return [
        {
            "id": str(row["customer_id"]) if row["customer_id"] else None,
            "name": row["name"] or "Walk-in",
            "phone": row["phone"] or "",
            "openRentals": row["rentals"],
            "oldestOpen": row["oldest"],
            "owed": row["owed"],
        }
        for row in rows[:limit]
    ]


def _latest(field):
    """A label for a group, taken from the frozen text on its rows.

    `Max` over the text is deliberate, not ideal: product and customer names are frozen
    onto each rental line at rent-out, so a product renamed mid-year has two spellings in
    the data and this picks one. It only ever affects the label — the grouping is by
    product or customer id, so a renamed product still totals as a single row.
    """
    return Max(field)


# ---------- CSV ----------


def csv_rows(business: Business, report: str, rng: Range, group=""):
    """`(filename, header, rows)` for one report, as an iterator of value tuples.

    The iterator matters: an owner exporting a year of returns must not build a list of
    50,000 Python objects to write a file, so the queryset is walked lazily and each row is
    turned into text as it goes.
    """
    builder = EXPORTS.get(report)
    if builder is None:
        return None
    name, header, rows = builder(business, rng, group)
    return f"{name}_{rng.slug()}.csv", header, rows


def _export_revenue(business, rng, group):
    group, rows = revenue_series(business, rng, group)
    label = {"day": "Day", "week": "Week starting", "month": "Month"}[group]
    header = [label, "Returns", "Rent", "Late fees", "Damage fees", "Discounts", "Revenue"]
    return (
        f"revenue_by_{group}",
        header,
        (
            [r["period"], r["returns"], r["rent"], r["lateFees"], r["damageFees"], r["discounts"], r["revenue"]]
            for r in rows
        ),
    )


def _export_products(business, rng, group):
    header = ["Product", "SKU", "Rentals", "Units returned", "Damaged", "Lost", "Rent", "Late fees", "Damage fees", "Revenue"]
    rows = (
        [r["name"], r["sku"], r["rentals"], r["units"], r["damaged"], r["lost"], r["rent"], r["lateFees"], r["damageFees"], r["revenue"]]
        for r in top_products(business, rng, limit=MAX_TOP_N)
    )
    return "products", header, rows


def _export_customers(business, rng, group):
    header = ["Customer", "Phone", "Rentals", "Returns", "Rent", "Late fees", "Damage fees", "Discounts", "Revenue", "Outstanding"]
    rows = (
        [
            r["name"], r["phone"], r["rentals"], r["returns"], r["rent"], r["lateFees"],
            r["damageFees"], r["discounts"], r["revenue"], r["outstanding"],
        ]
        for r in top_customers(business, rng, limit=MAX_TOP_N)
    )
    return "customers", header, rows


def _export_rentals(business, rng, group):
    """Every rental started in the range, one row each. The owner's audit trail."""
    header = [
        "Rental", "Started", "Due", "Status", "Customer", "Phone", "Items", "Units out",
        "Rent", "Late fees", "Damage fees", "Discount", "Charges", "Paid", "Balance", "Taken by",
    ]
    qs = (
        Rental.objects.filter(business=business, started_at__gte=rng.start, started_at__lt=rng.end)
        .select_related("customer", "created_by")
        .annotate(
            item_count=Count("items", distinct=True),
            out=units(F("items__quantity") - F("items__quantity_returned") - F("items__quantity_lost")),
        )
        .order_by("number")
    )

    def rows():
        for rental in qs.iterator(chunk_size=500):
            yield [
                rental.code,
                _when(rental.started_at),
                _when(rental.due_at),
                rental.get_status_display(),
                rental.customer.name if rental.customer else "Walk-in",
                rental.customer.phone if rental.customer else "",
                rental.item_count,
                rental.out,
                rental.rent_total,
                rental.late_fee,
                rental.damage_fee,
                rental.discount,
                rental.charges,
                rental.paid_amount,
                rental.balance,
                rental.created_by.name if rental.created_by else "",
            ]

    return "rentals", header, rows()


def _export_returns(business, rng, group):
    """Every return taken in the range: the line-by-line record behind the revenue figure."""
    header = [
        "Return", "Taken at", "Rental", "Customer", "Product", "SKU", "Quantity",
        "Condition", "Days billed", "Rent", "Late fee", "Damage fee", "Taken by",
    ]
    qs = (
        RentalReturnLine.objects.filter(
            rental_return__business=business, rental_return__at__gte=rng.start, rental_return__at__lt=rng.end
        )
        .select_related("rental_return", "rental_return__rental", "rental_return__rental__customer", "rental_return__by", "item")
        .order_by("rental_return__number", "id")
    )

    def rows():
        for line in qs.iterator(chunk_size=500):
            taken = line.rental_return
            yield [
                taken.code,
                _when(taken.at),
                taken.rental.code,
                taken.rental.customer.name if taken.rental.customer else "Walk-in",
                line.item.product_name,
                line.item.product_sku,
                line.quantity,
                line.get_condition_display(),
                line.days_out,
                line.rent_amount,
                line.late_fee,
                line.damage_fee,
                taken.by.name if taken.by else "",
            ]

    return "returns", header, rows()


def _export_payments(business, rng, group):
    """Money in and out against rentals: the figure to reconcile the till against."""
    header = ["When", "Rental", "Customer", "Kind", "Method", "Reference", "Amount", "Taken by", "Note"]
    qs = (
        RentalPayment.objects.filter(business=business, at__gte=rng.start, at__lt=rng.end)
        .select_related("rental", "rental__customer", "by")
        .order_by("at", "id")
    )

    def rows():
        for payment in qs.iterator(chunk_size=500):
            yield [
                _when(payment.at),
                payment.rental.code,
                payment.rental.customer.name if payment.rental.customer else "Walk-in",
                payment.get_kind_display(),
                payment.get_method_display(),
                payment.reference,
                payment.amount,
                payment.by.name if payment.by else "",
                payment.note,
            ]

    return "payments", header, rows()


def _export_debtors(business, rng, group):
    header = ["Customer", "Phone", "Rentals still out", "Owes"]
    rows = ([r["name"], r["phone"], r["openRentals"], r["owed"]] for r in debtors(business, limit=MAX_TOP_N))
    return "who_owes", header, rows


def _when(value):
    """A timestamp as the shop's own local time, written so a spreadsheet reads it as one."""
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value else ""


EXPORTS = {
    "revenue": _export_revenue,
    "products": _export_products,
    "customers": _export_customers,
    "rentals": _export_rentals,
    "returns": _export_returns,
    "payments": _export_payments,
    "debtors": _export_debtors,
}


# ---------- The whole report ----------


def overview(business: Business, rng: Range, group=""):
    """Everything the printed report shows, in one dictionary.

    The PDF is drawn from this, so it carries the same figures as the screen: both are
    built from the functions above.
    """
    group, series = revenue_series(business, rng, group)
    return {
        "business": {
            "name": business.name,
            "phone": business.phone,
            "address": business.address,
            "currency": business.settings.get("currency", "BDT"),
        },
        "generated_at": timezone.now(),
        "label": range_label(rng),
        "summary": summary(business, rng),
        "group": group,
        "revenue": series,
        "products": top_products(business, rng, limit=10),
        "customers": top_customers(business, rng, limit=10),
        "debtors": debtors(business, limit=15),
    }


def range_label(rng: Range):
    first, last = rng.start.date(), rng.last_day
    if first == last:
        return f"{first.day} {first:%B %Y}"
    return f"{first.day} {first:%b %Y} – {last.day} {last:%b %Y}"
