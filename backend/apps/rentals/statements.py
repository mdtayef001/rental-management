"""Bills: what one customer owes for a month, a year, or any stretch of days.

A receipt is about one rental. A bill is about one *customer* over a *period*: a company
that takes machines whenever it needs them wants one sheet at the end of the month listing
every time it took something, what came back, what is still with it, and what all of that
cost — not forty slips.

The difficulty is that rent on a rental is only final when the items come back, and a
company's machines may stay out for a year. So a bill charges what has **run up** in its
period rather than what was returned in it:

    charged in a period = run up by the end of it − run up by the start of it

"Run up by T" is the real amount for anything already back by T, and for anything still out
at T it is what returning it at T would have cost — the same `RentalItem.quote` the counter
uses. Because each bill is a difference between two such totals, consecutive bills always
add up to exactly what the rental finally cost, with nothing counted twice and nothing
missed, however the returns fall across the months.

Late fees, damage charges and discounts are decided at a return, so they land in the
period that return happened in.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import DecimalField, F, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.reports.services import Range, day_start, parse_date

from .models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine

ZERO = Decimal("0.00")
MONEY = DecimalField(max_digits=14, decimal_places=2)


def money(value):
    return (value or ZERO).quantize(Decimal("0.01"))


# ---------- The period ----------


def parse_period(params):
    """`?from=&to=` as whole local days. With neither, the current month so far."""
    today = timezone.localdate()
    start = parse_date(params.get("from"))
    to = parse_date(params.get("to"))
    if start is None and to is None:
        start, to = today.replace(day=1), today
    elif start is None:
        start = to.replace(day=1)
    elif to is None:
        to = month_end(start)
    if start > to:
        start, to = to, start
    return Range(start=day_start(start), end=day_start(to + timedelta(days=1)), last_day=to)


def month_end(day):
    return (day.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def period_kind(rng):
    """month | year | custom — which decides what the bill is called."""
    first, last = rng.start.date(), rng.last_day
    if first.day == 1 and last == month_end(first):
        return "month"
    if (first.month, first.day) == (1, 1) and (last.month, last.day) == (12, 31) and first.year == last.year:
        return "year"
    return "custom"


def period_label(rng):
    first, last = rng.start.date(), rng.last_day
    kind = period_kind(rng)
    if kind == "month":
        return first.strftime("%B %Y")
    if kind == "year":
        return str(first.year)
    return f"{short_date(first)} – {short_date(last)}"


def short_date(day):
    return f"{day.day} {day.strftime('%b %Y')}"


def bill_number(customer, rng):
    """The same bill always gets the same number, so a reprint matches the copy already sent."""
    first, last = rng.start.date(), rng.last_day
    kind = period_kind(rng)
    if kind == "month":
        stamp = first.strftime("%Y%m")
    elif kind == "year":
        stamp = str(first.year)
    else:
        stamp = f"{first:%Y%m%d}-{last:%Y%m%d}"
    return f"BILL-{customer.id:04d}-{stamp}"


# ---------- Running up rent ----------


def run_up(item, started_at, quantity, at, *, holidays=0, final=None):
    """Rent `quantity` units of `item` had run up by `at`.

    `final` is what the units were really charged when they came back. An estimate made
    before that return is capped at it, so a free day agreed at the return can only ever
    make the last bill smaller — never a past bill wrong.
    """
    if quantity <= 0 or at <= started_at:
        return ZERO
    amount = RentalItem.quote(item.plan, item.rate, RentalItem.count_days(started_at, at), quantity, holidays)
    return min(amount, final) if final is not None else amount


def days_by(began, at):
    """Days out by `at`, counted the way the counter counts them. None before it left."""
    return RentalItem.count_days(began, at) if at > began else 0


def charged_days(plan, days, holidays):
    """Days that cost money. Days off only come off a per-day plan — see `RentalItem.quote`."""
    if plan != RentalItem.Plan.DAILY:
        return days
    return max(days - max(int(holidays or 0), 0), 0)


def stretch(item, began, quantity, start, until, *, holidays, rent, back_at=None, condition="", late=ZERO, damage=ZERO):
    """One group of units that share the same dates, as a row of the bill.

    "50 machines, out 3 Nov, back 20 Nov, 17 days, 2 off" — the line a customer checks
    against their own gate register. Days are the ones that fall inside the bill's period.
    """
    days = days_by(began, until) - days_by(began, start)
    charged = charged_days(item.plan, days_by(began, until), holidays) - charged_days(item.plan, days_by(began, start), holidays)
    return {
        "quantity": quantity,
        "out_at": began,
        "back_at": back_at,
        "condition": condition,
        "days": max(days, 0),
        "days_off": max(days - charged, 0),
        "rent": rent,
        "late_fee": late,
        "damage_fee": damage,
    }


def merge_stretches(stretches):
    """Units with identical dates and days read as one row, not one per return slip."""
    merged = {}
    for row in stretches:
        key = (row["back_at"], row["condition"], row["days"], row["days_off"])
        if key in merged:
            for field in ("quantity", "rent", "late_fee", "damage_fee"):
                merged[key][field] += row[field]
        else:
            merged[key] = dict(row)
    rows = sorted(merged.values(), key=lambda r: (r["back_at"] is None, r["back_at"] or r["out_at"]))
    for row in rows:
        for field in ("rent", "late_fee", "damage_fee"):
            row[field] = money(row[field])
        row["total"] = money(row["rent"] + row["late_fee"] + row["damage_fee"])
    return rows


def item_between(item, rental, start, end):
    """One rental line across `start <= t < end`: what moved and what it cost."""
    began = rental.started_at
    rent_before = rent_after = late = damage = ZERO
    back_before = back_by_end = 0
    came_back = []
    stretches = []

    for line in item.return_lines.all():
        at = line.rental_return.at
        if at < start:
            back_before += line.quantity
            before = line.rent_amount
        else:
            before = run_up(item, began, line.quantity, start, holidays=line.holidays, final=line.rent_amount)
        if at < end:
            back_by_end += line.quantity
            after = line.rent_amount
        else:
            after = run_up(item, began, line.quantity, end, holidays=line.holidays, final=line.rent_amount)
        rent_before += before
        rent_after += after
        inside = start <= at < end
        if inside:
            late += line.late_fee
            damage += line.damage_fee
            came_back.append({"at": at, "quantity": line.quantity, "condition": line.condition})
        if at >= start and began < end:
            stretches.append(
                stretch(
                    item, began, line.quantity, start, min(at, end),
                    holidays=line.holidays, rent=after - before,
                    # Units that came back after this period were still out when it closed.
                    back_at=at if inside else None,
                    condition=line.condition if inside else "",
                    late=line.late_fee if inside else ZERO,
                    damage=line.damage_fee if inside else ZERO,
                )
            )

    # Whatever no return has accounted for is still with the customer today.
    still_out = item.quantity_out
    before = run_up(item, began, still_out, start, holidays=item.holidays)
    after = run_up(item, began, still_out, end, holidays=item.holidays)
    rent_before += before
    rent_after += after
    if still_out and began < end:
        stretches.append(stretch(item, began, still_out, start, end, holidays=item.holidays, rent=after - before))

    exists_at_start = began < start
    exists_at_end = began < end
    out_at_end = item.quantity - back_by_end if exists_at_end else 0
    rent = rent_after - rent_before

    return {
        "product_name": item.product_name,
        "product_sku": item.product_sku,
        "plan": item.plan,
        "rate": item.rate,
        "quantity": item.quantity,
        "out_at_start": item.quantity - back_before if exists_at_start else 0,
        "taken": item.quantity if start <= began < end else 0,
        "returned": sum(r["quantity"] for r in came_back),
        "returns": sorted(came_back, key=lambda r: r["at"]),
        # The same line split by when the units came back: one row of the printed bill each.
        "stretches": merge_stretches(stretches),
        "out_at_end": out_at_end,
        # The stretch of this period the line was being charged for.
        "billed_from": max(began, start) if exists_at_end else None,
        # `end` is the first moment *after* the period, so step back inside it for the date.
        "billed_to": (
            (end - timedelta(seconds=1) if out_at_end else max((r["at"] for r in came_back), default=None))
            if exists_at_end
            else None
        ),
        "rent": money(rent),
        "late_fee": money(late),
        "damage_fee": money(damage),
        "total": money(rent + late + damage),
    }


def rental_between(rental, start, end):
    """One rental across a period, or None when the period has nothing to say about it."""
    if rental.started_at >= end:
        return None
    lines = [item_between(item, rental, start, end) for item in rental.items.all()]
    lines = [
        line for line in lines
        if line["out_at_start"] or line["taken"] or line["returned"] or line["total"]
    ]
    discount = sum((r.discount for r in rental.returns.all() if start <= r.at < end), ZERO)
    if not lines and not discount:
        return None
    rent = sum((line["rent"] for line in lines), ZERO)
    late = sum((line["late_fee"] for line in lines), ZERO)
    damage = sum((line["damage_fee"] for line in lines), ZERO)
    return {
        "id": str(rental.id),
        "code": rental.code,
        "status": rental.status,
        "started_at": rental.started_at,
        "due_at": rental.due_at,
        "returned_at": rental.returned_at,
        "lines": lines,
        "rent": money(rent),
        "late_fee": money(late),
        "damage_fee": money(damage),
        "discount": money(discount),
        "total": money(rent + late + damage - discount),
        "units_out": sum(line["out_at_end"] for line in lines),
    }


def run_up_total(rental, at):
    """Everything a rental had charged by `at`: rent, fees, less discounts."""
    total = ZERO
    for item in rental.items.all():
        for line in item.return_lines.all():
            if line.rental_return.at < at:
                total += line.rent_amount + line.late_fee + line.damage_fee
            else:
                total += run_up(item, rental.started_at, line.quantity, at, holidays=line.holidays, final=line.rent_amount)
        total += run_up(item, rental.started_at, item.quantity_out, at, holidays=item.holidays)
    total -= sum((r.discount for r in rental.returns.all() if r.at < at), ZERO)
    return total


def billable(business):
    """Rentals a bill can be about: a named customer's, and not cancelled."""
    return (
        Rental.objects.filter(business=business, customer__isnull=False)
        .exclude(status=Rental.Status.CANCELLED)
        .prefetch_related(
            Prefetch("items", queryset=RentalItem.objects.order_by("id")),
            Prefetch("items__return_lines", queryset=RentalReturnLine.objects.select_related("rental_return")),
            Prefetch("returns", queryset=RentalReturn.objects.only("id", "rental_id", "at", "discount")),
        )
    )


def touching(qs, start, end):
    """Rentals that were out at some point in the period.

    One that was completely back before the period began has nothing left to charge, so it
    is left to a single SQL sum instead of being loaded and walked.
    """
    return qs.filter(started_at__lt=end).filter(Q(status__in=Rental.OPEN) | Q(returned_at__gte=start))


def cutoff(rng):
    """A bill never charges for days that haven't happened yet."""
    return min(rng.end, timezone.now())


# ---------- One customer's bill ----------


def build_statement(business, customer, rng):
    """The whole bill for one customer and one period, ready to show or print."""
    start, end = rng.start, max(cutoff(rng), rng.start)
    mine = billable(business).filter(customer=customer)

    rentals = []
    opening = ZERO
    for rental in touching(mine, start, end).order_by("started_at", "id"):
        opening += run_up_total(rental, start)
        row = rental_between(rental, start, end)
        if row:
            rentals.append(row)

    # Rentals finished before the period: their charges are final, so the database adds them.
    finished = mine.filter(status=Rental.Status.RETURNED, returned_at__lt=start).aggregate(
        n=Coalesce(Sum(F("rent_total") + F("late_fee") + F("damage_fee") - F("discount")), Value(0), output_field=MONEY)
    )["n"]
    opening += finished

    payments_qs = RentalPayment.objects.filter(business=business, rental__customer=customer).exclude(
        rental__status=Rental.Status.CANCELLED
    )
    # Every payment counts against what they owe — money paid in advance included — and
    # anything given back counts the other way, being a negative amount.
    paid_before = payments_qs.filter(at__lt=start).aggregate(
        n=Coalesce(Sum("amount"), Value(0), output_field=MONEY)
    )["n"]
    payments = [
        {
            "id": str(p.id),
            "at": p.at,
            "rental_code": p.rental.code,
            "method": p.method,
            "reference": p.reference,
            "note": p.note,
            "amount": p.amount,
        }
        for p in payments_qs.filter(at__gte=start, at__lt=end)
        .select_related("rental")
        .order_by("at", "id")
    ]
    rent = sum((r["rent"] for r in rentals), ZERO)
    late = sum((r["late_fee"] for r in rentals), ZERO)
    damage = sum((r["damage_fee"] for r in rentals), ZERO)
    discount = sum((r["discount"] for r in rentals), ZERO)
    charges = rent + late + damage - discount
    paid = sum((p["amount"] for p in payments), ZERO)
    opening_balance = opening - paid_before

    return {
        "number": bill_number(customer, rng),
        "kind": period_kind(rng),
        "label": period_label(rng),
        "from": rng.start.date().isoformat(),
        "to": rng.last_day.isoformat(),
        # Set when the period isn't over yet, so the bill can say it only runs to today.
        "as_of": timezone.localtime(end).isoformat() if end < rng.end else None,
        "issued_at": timezone.now(),
        "business": {
            "name": business.name,
            "phone": business.phone,
            "address": business.address,
            "currency": business.settings.get("currency", "BDT"),
            "note": business.receipt_note,
            "logo_version": business.logo_version,
        },
        "customer": {
            "id": str(customer.id),
            "name": customer.name,
            "company": customer.company,
            "phone": customer.phone,
            "email": customer.email,
            "address": customer.address,
        },
        "rentals": rentals,
        "payments": payments,
        "totals": {
            "rent": money(rent),
            "late_fee": money(late),
            "damage_fee": money(damage),
            "discount": money(discount),
            "charges": money(charges),
            "paid": money(paid),
            "opening_balance": money(opening_balance),
            "closing_balance": money(opening_balance + charges - paid),
            "units_out": sum(r["units_out"] for r in rentals),
            "units_taken": sum(line["taken"] for r in rentals for line in r["lines"]),
            "units_returned": sum(line["returned"] for r in rentals for line in r["lines"]),
            "days_off": sum(s["days_off"] for r in rentals for line in r["lines"] for s in line["stretches"]),
        },
    }


# ---------- Everyone's bills for a period ----------


def period_bills(business, rng, search=""):
    """One row per customer with anything to bill or anything paid in the period.

    This is the month-end screen: who gets a bill, for how much. Sorted by what they were
    charged, largest first, because those are the bills worth sending first.
    """
    start, end = rng.start, max(cutoff(rng), rng.start)
    rows = defaultdict(lambda: {"charges": ZERO, "paid": ZERO, "units_out": 0, "rentals": 0})

    for rental in touching(billable(business), start, end):
        row = rental_between(rental, start, end)
        if row:
            mine = rows[rental.customer_id]
            mine["charges"] += row["total"]
            mine["units_out"] += row["units_out"]
            mine["rentals"] += 1

    paid = (
        RentalPayment.objects.filter(
            business=business, rental__customer__isnull=False, at__gte=start, at__lt=end
        )
        .exclude(rental__status=Rental.Status.CANCELLED)
        .values("rental__customer_id")
        .annotate(n=Sum("amount"))
    )
    for entry in paid:
        rows[entry["rental__customer_id"]]["paid"] += entry["n"]

    from apps.catalog.models import Customer

    customers = Customer.objects.filter(business=business, id__in=rows.keys())
    text = (search or "").strip()
    if text:
        customers = customers.filter(Q(name__icontains=text) | Q(company__icontains=text) | Q(phone__icontains=text))

    result = [
        {
            "customer_id": str(c.id),
            "customer_name": c.name,
            "company": c.company,
            "phone": c.phone,
            "rentals": rows[c.id]["rentals"],
            "units_out": rows[c.id]["units_out"],
            "charges": money(rows[c.id]["charges"]),
            "paid": money(rows[c.id]["paid"]),
        }
        for c in customers
    ]
    result.sort(key=lambda r: (-r["charges"], r["customer_name"].lower()))
    return result


# ---------- Paying a bill ----------


@transaction.atomic
def receive_payment(*, user, customer, amount, method="", reference="", note=""):
    """One payment from a customer, spread over what they owe.

    A company settling its monthly bill writes one cheque, not one per rental. The money
    goes to the oldest rental that still owes something first — including rent that has run
    up on machines not yet returned — and anything left over sits as credit on their most
    recent rental, where the next return will use it up.
    """
    from . import services

    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError("A payment has to be more than zero.")

    rentals = list(
        billable(user.business)
        .filter(customer=customer)
        .select_for_update(of=("self",))
        .order_by("started_at", "id")
    )
    if not rentals:
        raise ValidationError(f"{customer.name} has no rentals to put a payment against.")

    now = timezone.now()
    left = amount
    paid = []
    for rental in rentals:
        if left <= 0:
            break
        owing = money(run_up_total(rental, now) - rental.paid_amount)
        if owing <= 0:
            continue
        part = min(owing, left)
        services.add_payment(user=user, rental=rental, amount=part, method=method, reference=reference, note=note)
        paid.append({"rental_code": rental.code, "amount": part})
        left -= part

    if left > 0:
        # Paid ahead. Prefer a rental that is still open, since that is where the next
        # charge will land.
        target = next((r for r in reversed(rentals) if r.is_open), rentals[-1])
        services.add_payment(
            user=user, rental=target, amount=left, method=method, reference=reference,
            note=note or "Paid in advance",
        )
        paid.append({"rental_code": target.code, "amount": left})

    return paid
