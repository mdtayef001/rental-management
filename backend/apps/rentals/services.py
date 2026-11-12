"""Renting out, taking back, and the money that goes with it.

Three rules hold this file together:

1. **Stock and rentals can never disagree.** Every unit that leaves the shelf is on an open
   rental item, and every unit on an open rental item is off the shelf. Both sides move in
   one transaction, or neither does.
2. **Numbers are allocated under a business lock.** Rental, return and receipt numbers are
   per business and gapless, so two staff members ringing up at the same moment can't take
   the same number.
3. **Money is only final at return**, because the price depends on how long the item was
   actually out. The quote shown while filling the form uses the same arithmetic the server
   charges (RentalItem.quote), so the figure never changes under the customer's nose.
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import F, Max, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Business, log
from apps.catalog.models import StockMovement
from apps.catalog.services import change_stock, customer_rate, set_customer_rate

from .models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine

ZERO = Decimal("0.00")


def lock_business(business_id):
    """Serialises number allocation for one business.

    Taking a lock on the business row means two tills can't both read "last number 41" and
    both write 42. Other businesses are unaffected, so this never becomes a global queue.
    """
    return Business.objects.select_for_update().filter(pk=business_id).first()


def next_number(model, business_id):
    """The next per-business number for rentals or returns. Caller must hold the lock."""
    last = model.objects.filter(business_id=business_id).aggregate(n=Max("number"))["n"] or 0
    return last + 1


# ---------- Renting out ----------


@transaction.atomic
def create_rental(*, user, customer, branch, lines, started_at=None, due_at=None, notes="", paid_amount=ZERO, payment_method="", payment_reference="", remember_rates=False):
    """Rent several products to one customer in one transaction.

    `lines` is a list of dicts: product, quantity, plan, rate, and optionally
    replacement_cost, holidays and note. Stock leaves the branch for each line; if any line
    can't be filled, the whole rental is rolled back and nothing moves.

    A line without a rate uses the price agreed with this customer, and failing that the
    product's own. `remember_rates` writes today's rates down as the customer's prices, so
    the next rental starts from them.

    There is no deposit. `paid_amount` is money the customer pays in advance: it sits on the
    rental as credit and the rent is charged against it when the items come back.
    """
    if remember_rates and user.role == "staff":
        raise ValidationError("Only the owner or a manager can change a customer's prices.")
    if not lines:
        raise ValidationError("Add at least one product to the rental.")
    # Every rental has a named customer: a bill has to be sent to someone, and items that
    # don't come back have to be chased from someone.
    if customer is None:
        raise ValidationError({"customer": "Pick or add a customer for this rental."})
    if customer.archived_at:
        raise ValidationError({"customer": f"{customer.name} has been removed from your customers. Add them again to rent to them."})
    if customer.blocked:
        raise ValidationError(f"{customer.name} is blocked from renting: {customer.blocked_reason or 'no reason given'}.")

    started_at = started_at or timezone.now()
    if due_at and due_at <= started_at:
        raise ValidationError({"dueAt": "The return date has to be after the rental starts."})
    if not due_at and not user.business.rental_setting("allowOpenEnded", True):
        raise ValidationError({"dueAt": "Set when the items are due back."})

    lock_business(user.business_id)
    rental = Rental.objects.create(
        business=user.business,
        number=next_number(Rental, user.business_id),
        customer=customer,
        branch=branch,
        started_at=started_at,
        due_at=due_at,
        notes=notes,
        created_by=user,
    )

    seen = set()
    for line in lines:
        product = line["product"]
        quantity = int(line["quantity"])
        if product.id in seen:
            raise ValidationError(f"{product.name} is on this rental twice. Put it on one line with the full quantity.")
        seen.add(product.id)
        if product.archived_at:
            raise ValidationError(f"{product.name} has been removed from your products.")
        if not product.rentable:
            raise ValidationError(f"{product.name} isn't marked as rentable.")

        plan = line["plan"]
        rate = line.get("rate")
        if rate is None:
            rate = customer_rate(customer, product, plan)
        if rate is None:
            rate = product.rate_for(plan)
        if rate is None:
            raise ValidationError(f"{product.name} has no {plan} rate. Set one on the product or type a rate.")

        # Takes the stock off the shelf, and refuses (rolling back the whole rental) if
        # there isn't enough.
        change_stock(
            product=product,
            branch=branch,
            change=-quantity,
            reason=StockMovement.Reason.RENT_OUT,
            user=user,
            note=rental.code,
        )
        RentalItem.objects.create(
            rental=rental,
            product=product,
            product_name=product.name,
            product_sku=product.sku,
            quantity=quantity,
            plan=plan,
            rate=rate,
            replacement_cost=line.get("replacement_cost", product.replacement_cost) or ZERO,
            holidays=line.get("holidays", 0) or 0,
            note=line.get("note", "") or "",
        )
        if remember_rates:
            set_customer_rate(user=user, customer=customer, product=product, plan=plan, rate=rate, quiet=True)

    if paid_amount:
        add_payment(
            user=user, rental=rental, amount=paid_amount, method=payment_method,
            reference=payment_reference, kind=RentalPayment.Kind.ADVANCE,
        )
        rental.refresh_from_db()

    items = list(rental.items.all())
    log(
        user,
        "Rented out",
        f"{rental.code} · {sum(i.quantity for i in items)} units across {len(items)} product(s)"
        + (f" to {customer.name}" if customer else " (walk-in)"),
    )
    return rental


# ---------- Finding what to take back ----------


def open_items(business, *, product=None, customer=None, rental=None, branch_ids=None):
    """Rental items that still have units with a customer.

    This one query answers every way of starting a return: by scanning a product, by naming
    a customer, or by opening a rental. `quantity_out` is computed in the database, so a
    busy shop's return screen is one indexed query rather than a loop over rentals.
    """
    qs = (
        RentalItem.objects.filter(rental__business=business, rental__status__in=Rental.OPEN)
        .annotate(out=F("quantity") - F("quantity_returned") - F("quantity_lost"))
        .filter(out__gt=0)
        .select_related("rental", "rental__customer", "rental__branch", "product")
        .order_by("rental__started_at", "id")
    )
    if product is not None:
        qs = qs.filter(product=product)
    if customer is not None:
        qs = qs.filter(rental__customer=customer)
    if rental is not None:
        qs = qs.filter(rental=rental)
    if branch_ids is not None:
        qs = qs.filter(rental__branch_id__in=branch_ids)
    return qs


def resolve_return(business, *, code="", customer=None, rental=None, branch_ids=None):
    """The scan-in flow: work out what the person in front of you is bringing back.

    This is the feature the client asked for by name. A scan can mean three different
    things, and all three come back in the same shape so the screen has one code path:

    * **A rental receipt's QR code** (`RN-000042` or its token) → that rental's open items.
    * **A product's barcode** → every open item of that product, which may be one customer
      or fifteen. One match is answered with `exact`, so the common case needs no tap.
    * **Nothing scannable** → the caller passes a customer or rental id instead.

    Several matches are *not* an error: they're the question "which of these are you
    returning?", and the answer carries enough to tell them apart — customer, rental code,
    how many are still out, how long they've been out and whether they're overdue.
    """
    from apps.catalog.services import find_by_code

    code = (code or "").strip()
    matched_by = None
    product = None

    if rental is not None:
        matched_by = "rental"
    elif customer is not None:
        matched_by = "customer"
    elif code:
        rental = find_rental_by_code(business, code)
        if rental is not None:
            matched_by = "rental"
        else:
            product = find_by_code(business, code, rentable_only=False)
            if product is None:
                return {"matchedBy": None, "product": None, "matches": [], "exact": None}
            matched_by = "product"

    items = list(open_items(business, product=product, customer=customer, rental=rental, branch_ids=branch_ids))
    now = timezone.now()
    matches = [item_match(item, now) for item in items]
    # One candidate: the screen can go straight to it instead of asking.
    exact = matches[0]["itemId"] if len(matches) == 1 else None
    return {
        "matchedBy": matched_by,
        "product": {"id": str(product.id), "name": product.name, "sku": product.sku} if product else None,
        "rental": rental_brief(rental) if rental else None,
        "matches": matches,
        "exact": exact,
    }


def find_rental_by_code(business, code):
    """A rental from its printed code (`RN-000042`, `rn42`, `42`) or its receipt token."""
    text = code.strip()
    token = text.rsplit("/", 1)[-1] if "/" in text else text
    rental = Rental.objects.filter(business=business, token=token).first()
    if rental:
        return rental
    digits = "".join(c for c in text if c.isdigit())
    prefix = text.upper().startswith("RN") or text.upper().startswith("RN-")
    # A bare number is only read as a rental number when it came with the RN prefix;
    # otherwise it's far more likely to be a product barcode.
    if digits and prefix:
        return Rental.objects.filter(business=business, number=int(digits)).first()
    return None


def item_match(item, now=None):
    """One candidate on the return screen: enough to tell two rentals of the same product apart."""
    now = now or timezone.now()
    rental = item.rental
    days_out = RentalItem.count_days(rental.started_at, now)
    overdue_days = days_late_for(rental, now)
    return {
        "itemId": str(item.id),
        "rentalId": str(rental.id),
        "rentalCode": rental.code,
        "customerId": str(rental.customer_id) if rental.customer_id else None,
        "customerName": rental.customer.name if rental.customer else "Walk-in",
        "customerPhone": rental.customer.phone if rental.customer else "",
        "branchName": rental.branch.name if rental.branch else "",
        "productId": str(item.product_id) if item.product_id else None,
        "productName": item.product_name,
        "productSku": item.product_sku,
        "quantity": item.quantity,
        "quantityReturned": item.quantity_returned,
        "quantityLost": item.quantity_lost,
        "quantityOut": item.quantity_out,
        "plan": item.plan,
        "rate": item.rate,
        "replacementCost": item.replacement_cost,
        # Paid in advance on this rental and not yet used: the return screen takes it off
        # what is owed before asking for any more money.
        "rentalCredit": rental.credit,
        "startedAt": rental.started_at,
        "dueAt": rental.due_at,
        "daysOut": days_out,
        "overdueDays": overdue_days,
        "isOverdue": overdue_days > 0,
        # What this line would cost if everything still out came back right now, so the
        # chooser can show the money without a second round trip.
        "quoteNow": item.quote_now(at=now),
    }


def rental_brief(rental):
    return {
        "id": str(rental.id),
        "code": rental.code,
        "status": rental.status,
        "customerName": rental.customer.name if rental.customer else "Walk-in",
        "startedAt": rental.started_at,
        "dueAt": rental.due_at,
        "balance": rental.balance,
    }


# ---------- Taking items back ----------


def days_late_for(rental, at):
    """How many days late a return is, counting any started day.

    Deliberately the same rule as `RentalItem.count_days`: a return four hours into the
    sixth day is five days late, not four. Rent and late fees therefore never disagree
    about how long something was out.
    """
    if not rental.due_at or at <= rental.due_at:
        return 0
    return RentalItem.count_days(rental.due_at, at)


def late_fee_for(business, item, days_late, quantity):
    """What being `days_late` days late costs for `quantity` units of `item`.

    Charged as a multiple of the item's daily value, set by the owner
    (`rentals.lateFeeMultiplier`).

    Note this is **on top of** the rent for those days, which is already charged because the
    item was still out. At the default multiplier of 1.0 a late day therefore costs twice a
    normal day: one day's rent plus one day's penalty. An owner who wants late days charged
    at the plain rate sets the multiplier to 0, and one who wants a 50% surcharge sets 0.5.

    An item on a fixed price has no daily value, so its own rate stands in for one.
    """
    multiplier = Decimal(str(business.rental_setting("lateFeeMultiplier", 1.0) or 0))
    if days_late <= 0 or multiplier <= 0:
        return ZERO
    if item.plan == RentalItem.Plan.DAILY:
        daily = item.rate
    elif item.plan == RentalItem.Plan.WEEKLY:
        daily = item.rate / 7
    elif item.plan == RentalItem.Plan.MONTHLY:
        daily = item.rate / 30
    else:
        daily = item.rate
    return (daily * multiplier * days_late * quantity).quantize(Decimal("0.01"))


@transaction.atomic
def take_return(*, user, rental, lines, at=None, discount=ZERO, paid_amount=ZERO, refunded=ZERO, payment_method="", payment_reference="", note=""):
    """Take some or all of a rental's items back.

    `lines` is a list of dicts: item, quantity, condition, and optionally holidays and note.
    Everything is charged for the days it was actually out, which is why a partial return
    can't simply be "a fraction of the rental" — the 40 machines still out keep running.

    Conditions:
      * `good`    — back on the shelf, charged rent for the days out.
      * `damaged` — back on the shelf but written off as damaged stock, and charged the
                    replacement cost on top of the rent.
      * `lost`    — never coming back: no stock movement, charged the replacement cost.
    """
    if not lines:
        raise ValidationError("Say what is coming back.")
    if not user.may_take_returns:
        raise ValidationError("You haven't been given permission to take returns.")

    # Lock the rental first, then the business for the number: always the same order, so two
    # returns on different rentals can never deadlock each other.
    rental = (
        Rental.objects.select_for_update(of=("self",))
        .select_related("business", "branch", "customer")
        .get(pk=rental.pk)
    )
    if not rental.is_open:
        raise ValidationError("Everything on this rental is already back.")

    at = at or timezone.now()
    if at < rental.started_at:
        raise ValidationError("A return can't be dated before the rental started.")

    lock_business(rental.business_id)
    rental_return = RentalReturn(
        business_id=rental.business_id,
        number=next_number(RentalReturn, rental.business_id),
        rental=rental,
        at=at,
        discount=discount or ZERO,
        payment_method=payment_method,
        payment_reference=payment_reference,
        note=note,
        by=user,
    )
    rental_return.save()

    business = rental.business
    days_late = days_late_for(rental, at)
    rent_total = late_total = damage_total = ZERO

    for line in lines:
        item = (
            RentalItem.objects.select_for_update(of=("self",))
            .select_related("product")
            .get(pk=line["item"].pk, rental=rental)
        )
        quantity = int(line["quantity"])
        condition = line.get("condition", RentalReturnLine.Condition.GOOD)

        if quantity <= 0:
            raise ValidationError("A returned quantity has to be at least 1.")
        if quantity > item.quantity_out:
            raise ValidationError(
                f"Only {item.quantity_out} of {item.product_name} are still out on {rental.code}; "
                f"you entered {quantity}."
            )

        holidays = min(int(line.get("holidays", item.holidays) or 0), 10_000)
        days_out = RentalItem.count_days(rental.started_at, at)
        rent = item.quote(item.plan, item.rate, days_out, quantity, holidays)
        late = late_fee_for(business, item, days_late, quantity)
        damage = ZERO
        if condition in (RentalReturnLine.Condition.DAMAGED, RentalReturnLine.Condition.LOST):
            damage = item.replacement_cost * quantity

        RentalReturnLine.objects.create(
            rental_return=rental_return,
            item=item,
            quantity=quantity,
            condition=condition,
            days_out=days_out,
            holidays=holidays,
            rent_amount=rent,
            late_fee=late,
            damage_fee=damage,
            note=line.get("note", "") or "",
        )

        # Good and damaged units physically come back; lost ones don't. Damaged stock comes
        # back onto the shelf and is then written off, so the ledger shows both halves
        # instead of a unit silently disappearing.
        if item.product_id and rental.branch_id:
            if condition == RentalReturnLine.Condition.GOOD:
                change_stock(
                    product=item.product, branch=rental.branch, change=quantity,
                    reason=StockMovement.Reason.RENT_RETURN, user=user, note=rental.code,
                )
            elif condition == RentalReturnLine.Condition.DAMAGED:
                change_stock(
                    product=item.product, branch=rental.branch, change=quantity,
                    reason=StockMovement.Reason.RENT_RETURN, user=user, note=rental.code,
                )
                change_stock(
                    product=item.product, branch=rental.branch, change=-quantity,
                    reason=StockMovement.Reason.DAMAGE, user=user,
                    note=f"{rental.code} · returned damaged",
                )

        if condition == RentalReturnLine.Condition.LOST:
            item.quantity_lost = F("quantity_lost") + quantity
        else:
            item.quantity_returned = F("quantity_returned") + quantity
        item.days_out = days_out
        item.line_total = F("line_total") + rent + late + damage
        item.holidays = holidays
        item.save(update_fields=["quantity_returned", "quantity_lost", "days_out", "line_total", "holidays"])
        item.refresh_from_db()
        if not item.is_open:
            item.returned_at = at
            item.save(update_fields=["returned_at"])

        rent_total += rent
        late_total += late
        damage_total += damage

    rental_return.rent_total = rent_total
    rental_return.late_fee = late_total
    rental_return.damage_fee = damage_total
    rental_return.save(update_fields=["rent_total", "late_fee", "damage_fee"])

    # Roll the return's charges onto the rental.
    Rental.objects.filter(pk=rental.pk).update(
        rent_total=F("rent_total") + rent_total,
        late_fee=F("late_fee") + late_total,
        damage_fee=F("damage_fee") + damage_total,
        discount=F("discount") + (discount or ZERO),
    )
    rental.refresh_from_db()

    if paid_amount:
        add_payment(
            user=user, rental=rental, amount=paid_amount, method=payment_method,
            reference=payment_reference, kind=RentalPayment.Kind.RENT, rental_return=rental_return,
        )
        rental_return.paid_amount = paid_amount
        rental_return.save(update_fields=["paid_amount"])

    # Anything they paid in advance beyond what this came to can be handed straight back.
    if refunded:
        refund(user=user, rental=rental, amount=refunded, method=payment_method, rental_return=rental_return)
        rental_return.refunded = refunded
        rental_return.save(update_fields=["refunded"])

    close_if_done(rental, at)
    rental.refresh_from_db()

    units = sum(int(line["quantity"]) for line in lines)
    log(
        user,
        "Return taken",
        f"{rental_return.code} · {units} unit(s) back on {rental.code}"
        + (f" from {rental.customer.name}" if rental.customer else ""),
    )
    return rental_return


def close_if_done(rental, at=None):
    """Set the rental's status from what's actually still out.

    Derived rather than set by hand, so a rental can never read "returned" while a customer
    still has 40 machines.
    """
    still_out = (
        RentalItem.objects.filter(rental=rental)
        .annotate(out=F("quantity") - F("quantity_returned") - F("quantity_lost"))
        .filter(out__gt=0)
        .exists()
    )
    anything_back = RentalReturn.objects.filter(rental=rental).exists()
    if still_out:
        status = Rental.Status.PARTLY_RETURNED if anything_back else Rental.Status.ACTIVE
        returned_at = None
    else:
        status = Rental.Status.RETURNED
        returned_at = at or timezone.now()
    Rental.objects.filter(pk=rental.pk).update(status=status, returned_at=returned_at)
    return status


# ---------- Money ----------


@transaction.atomic
def add_payment(*, user, rental, amount, kind=RentalPayment.Kind.RENT, method="", reference="", note="", rental_return=None):
    """Record money taken from the customer against a rental."""
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError("A payment has to be more than zero.")
    payment = RentalPayment.objects.create(
        business_id=rental.business_id,
        rental=rental,
        rental_return=rental_return,
        amount=amount,
        kind=kind,
        method=method,
        reference=reference,
        note=note,
        by=user,
    )
    Rental.objects.filter(pk=rental.pk).update(paid_amount=F("paid_amount") + amount)
    log(user, "Payment taken", f"{rental.code} · {amount}")
    return payment


@transaction.atomic
def refund(*, user, rental, amount, method="", reference="", note="", rental_return=None):
    """Give the customer back money they paid and didn't use.

    Capped at the credit on the rental — what they have paid beyond what they have been
    charged — so the same money can't be handed back twice, which is the commonest way cash
    quietly leaks out of a rental shop. The rental row is locked while the cap is checked.
    """
    amount = Decimal(str(amount))
    rental = Rental.objects.select_for_update(of=("self",)).get(pk=rental.pk)
    if amount <= 0:
        raise ValidationError("A refund has to be more than zero.")
    if amount > rental.credit:
        raise ValidationError(
            f"Only {rental.credit} has been paid beyond what {rental.code} has been charged."
            if rental.credit
            else f"Nothing has been paid beyond what {rental.code} has been charged."
        )
    RentalPayment.objects.create(
        business_id=rental.business_id,
        rental=rental,
        rental_return=rental_return,
        amount=-amount,
        kind=RentalPayment.Kind.REFUND,
        method=method,
        reference=reference,
        note=note,
        by=user,
    )
    Rental.objects.filter(pk=rental.pk).update(paid_amount=F("paid_amount") - amount)
    log(user, "Money given back", f"{rental.code} · {amount}")
    rental.refresh_from_db()
    return rental


@transaction.atomic
def cancel_rental(*, user, rental, reason=""):
    """Undo a rental created by mistake: everything goes back on the shelf.

    Only while nothing has been returned yet — once a return exists, the rental has a
    history and must be finished properly rather than erased.
    """
    rental = Rental.objects.select_for_update(of=("self",)).select_related("branch").get(pk=rental.pk)
    if rental.status == Rental.Status.CANCELLED:
        return rental
    if RentalReturn.objects.filter(rental=rental).exists():
        raise ValidationError("Part of this rental has already come back, so it can't be cancelled.")
    if rental.paid_amount:
        raise ValidationError("Money has been taken against this rental. Give it back first, then cancel.")

    for item in rental.items.select_related("product"):
        if item.product_id and rental.branch_id and item.quantity_out:
            change_stock(
                product=item.product, branch=rental.branch, change=item.quantity_out,
                reason=StockMovement.Reason.RENT_RETURN, user=user,
                note=f"{rental.code} cancelled",
            )
    rental.status = Rental.Status.CANCELLED
    rental.notes = (rental.notes + f"\nCancelled: {reason}").strip() if reason else rental.notes
    rental.save(update_fields=["status", "notes"])
    log(user, "Rental cancelled", f"{rental.code}{f' · {reason}' if reason else ''}")
    return rental
