"""Recording purchases, returns to suppliers and payments out."""

from decimal import Decimal

from django.db import transaction
from django.db.models import F, Max, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import log
from apps.catalog.models import StockMovement
from apps.catalog.services import change_stock, total_on_hand
from apps.rentals.services import lock_business, next_number

from .models import PaymentAllocation, Purchase, PurchaseItem, Supplier, SupplierPayment, SupplierReturn

ZERO = Decimal("0.00")
PENNY = Decimal("0.01")


def average_cost(product, added_quantity, added_unit_cost):
    """The product's new cost: the weighted average of what was on hand and what came in.

    200 units at 50 plus 100 at 80 gives 60, not 80 — so the profit on the next rental
    reflects what the stock really cost, whichever physical unit goes out.
    """
    on_hand = total_on_hand(product)
    if added_quantity <= 0:
        return product.cost
    if on_hand <= 0:
        return Decimal(added_unit_cost).quantize(PENNY)
    total_value = product.cost * on_hand + Decimal(added_unit_cost) * added_quantity
    return (total_value / (on_hand + added_quantity)).quantize(PENNY)


@transaction.atomic
def create_purchase(*, user, supplier, branch, lines, purchased_at=None, reference="", note="", paid_amount=ZERO, method="", due_date=None):
    """Record a bill: raise the stock, re-average the cost, and note what's still owed."""
    if not lines:
        raise ValidationError("Add at least one product to the purchase.")
    if not user.may_add_stock:
        raise ValidationError("You haven't been given permission to add stock.")

    lock_business(user.business_id)
    purchase = Purchase.objects.create(
        business=user.business,
        number=next_number(Purchase, user.business_id),
        supplier=supplier,
        branch=branch,
        reference=reference,
        note=note,
        purchased_at=purchased_at or timezone.now(),
        due_date=due_date,
        created_by=user,
    )

    total = ZERO
    for line in lines:
        product = line["product"]
        quantity = int(line["quantity"])
        unit_cost = Decimal(str(line["unit_cost"]))

        # Re-average before the stock moves: the average needs the quantity on hand *before*
        # this delivery, and change_stock would already have added it.
        new_cost = average_cost(product, quantity, unit_cost)

        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            product_name=product.name,
            quantity=quantity,
            unit_cost=unit_cost,
        )
        change_stock(
            product=product, branch=branch, change=quantity,
            reason=StockMovement.Reason.PURCHASE, user=user, note=purchase.code,
        )
        product.cost = new_cost
        product.save(update_fields=["cost"])
        total += unit_cost * quantity

    purchase.total = total
    purchase.save(update_fields=["total"])

    paid_amount = Decimal(str(paid_amount or 0))
    if supplier is None and paid_amount < total:
        raise ValidationError("A purchase without a supplier has to be paid in full — there's nobody to owe.")
    if paid_amount > total:
        raise ValidationError("That's more than the bill's total.")
    if paid_amount:
        pay_supplier(user=user, supplier=supplier, amount=paid_amount, method=method, purchase=purchase, note=f"With {purchase.code}")

    purchase.refresh_from_db()
    log(user, "Stock bought in", f"{purchase.code} · {len(lines)} product(s) · {total}")
    return purchase


@transaction.atomic
def pay_supplier(*, user, supplier, amount, method="", purchase=None, note="", supplier_return=None):
    """Pay a supplier, against one bill or against their oldest unpaid bills first.

    Oldest first is the convention a shop expects: handing over 10,000 taka clears the
    bills that have been waiting longest, so the statement reads the way the ledger on
    paper did.
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError("A payment has to be more than zero.")

    lock_business(user.business_id)
    payment = SupplierPayment.objects.create(
        business=user.business,
        number=next_number(SupplierPayment, user.business_id),
        supplier=supplier,
        amount=amount,
        method=method,
        note=note,
        supplier_return=supplier_return,
        created_by=user,
    )

    if purchase is not None:
        targets = [Purchase.objects.select_for_update().get(pk=purchase.pk)]
    elif supplier is not None:
        targets = list(
            Purchase.objects.select_for_update()
            .filter(business=user.business, supplier=supplier)
            .exclude(paid_amount__gte=F("total"))
            .order_by("purchased_at", "id")
        )
    else:
        targets = []

    left = amount
    for bill in targets:
        if left <= 0:
            break
        owing = bill.total - bill.paid_amount
        if owing <= 0:
            continue
        part = min(owing, left)
        PaymentAllocation.objects.create(payment=payment, purchase=bill, amount=part)
        Purchase.objects.filter(pk=bill.pk).update(paid_amount=F("paid_amount") + part)
        left -= part

    if left > 0 and supplier is not None:
        # Paid more than is owed. Allowed — it's an advance — but recorded as unallocated
        # rather than silently inflating a bill.
        payment.note = (payment.note + f" · {left} on account").strip(" ·")
        payment.save(update_fields=["note"])

    log(user, "Supplier paid", f"{payment.code} · {amount}" + (f" to {supplier.name}" if supplier else ""))
    return payment


@transaction.atomic
def create_supplier_return(*, user, item, quantity, reason, branch=None):
    """Send faulty stock back. It leaves the shelf now and the supplier owes for it."""
    item = (
        PurchaseItem.objects.select_for_update(of=("self",))
        .select_related("purchase", "product")
        .get(pk=item.pk)
    )
    purchase = item.purchase
    quantity = int(quantity)
    if quantity <= 0:
        raise ValidationError("Say how many are going back.")
    if quantity > item.quantity_returnable:
        raise ValidationError(f"Only {item.quantity_returnable} of those are left on {purchase.code} to send back.")

    branch = branch or purchase.branch
    lock_business(user.business_id)
    supplier_return = SupplierReturn.objects.create(
        business=user.business,
        number=next_number(SupplierReturn, user.business_id),
        purchase=purchase,
        item=item,
        supplier=purchase.supplier,
        branch=branch,
        product=item.product,
        product_name=item.product_name,
        quantity=quantity,
        unit_cost=item.unit_cost,
        reason=reason,
        created_by=user,
    )
    if item.product_id and branch is not None:
        change_stock(
            product=item.product, branch=branch, change=-quantity,
            reason=StockMovement.Reason.SUPPLIER_RETURN, user=user, note=supplier_return.code,
        )
    PurchaseItem.objects.filter(pk=item.pk).update(quantity_returned=F("quantity_returned") + quantity)
    log(user, "Sent back to supplier", f"{supplier_return.code} · {quantity} × {item.product_name}")
    return supplier_return


@transaction.atomic
def settle_return(*, user, supplier_return, replaced_quantity=0, refunded_amount=ZERO, credited_amount=ZERO, close_note=""):
    """Settle a supplier return by replacement, refund, credit — or close it as a loss."""
    sr = (
        SupplierReturn.objects.select_for_update(of=("self",))
        .select_related("product", "branch", "supplier")
        .get(pk=supplier_return.pk)
    )
    if sr.status != SupplierReturn.Status.OPEN:
        raise ValidationError("This return is already finished.")

    replaced_quantity = int(replaced_quantity or 0)
    refunded_amount = Decimal(str(refunded_amount or 0))
    credited_amount = Decimal(str(credited_amount or 0))

    if close_note and not (replaced_quantity or refunded_amount or credited_amount):
        sr.status = SupplierReturn.Status.CLOSED
        sr.closed_note = close_note
        sr.finished_at = timezone.now()
        sr.save(update_fields=["status", "closed_note", "finished_at"])
        log(user, "Supplier return closed", f"{sr.code} · {close_note}")
        return sr

    # Validate everything against the values as they stand, *before* writing anything.
    # Reading `sr.outstanding` after assigning an F() expression to one of its fields would
    # be doing arithmetic on a query expression rather than on a number.
    if replaced_quantity > sr.units_to_replace:
        raise ValidationError(f"Only {sr.units_to_replace} more can be replaced on {sr.code}.")
    value_left = sr.outstanding - sr.unit_cost * replaced_quantity
    if refunded_amount + credited_amount > value_left:
        raise ValidationError(f"Only {value_left} is still outstanding on {sr.code}.")

    if replaced_quantity and sr.product_id and sr.branch_id:
        change_stock(
            product=sr.product, branch=sr.branch, change=replaced_quantity,
            reason=StockMovement.Reason.PURCHASE, user=user, note=f"{sr.code} replacement",
        )

    # F() expressions so two people settling the same return can't overwrite each other.
    SupplierReturn.objects.filter(pk=sr.pk).update(
        replaced_quantity=F("replaced_quantity") + replaced_quantity,
        refunded_amount=F("refunded_amount") + refunded_amount,
        credited_amount=F("credited_amount") + credited_amount,
    )
    sr.refresh_from_db()

    # A credit is money the supplier keeps against what the business owes them, so it pays
    # down their oldest bills exactly as cash would.
    if credited_amount and sr.supplier_id:
        pay_supplier(
            user=user, supplier=sr.supplier, amount=credited_amount,
            method=SupplierPayment.Method.CREDIT, note=f"Credit from {sr.code}", supplier_return=sr,
        )

    if sr.outstanding <= 0:
        sr.status = SupplierReturn.Status.SETTLED
        sr.finished_at = timezone.now()
        sr.save(update_fields=["status", "finished_at"])

    log(user, "Supplier return settled", f"{sr.code}")
    return sr


def supplier_balance(supplier):
    """What the business still owes this supplier across all their bills."""
    rows = Purchase.objects.filter(supplier=supplier).aggregate(
        total=Sum("total"), paid=Sum("paid_amount")
    )
    return (rows["total"] or ZERO) - (rows["paid"] or ZERO)


@transaction.atomic
def delete_supplier(*, user, supplier):
    if supplier.purchases.exists():
        raise ValidationError("This supplier has purchases recorded. They can't be deleted.")
    name = supplier.name
    supplier.delete()
    log(user, "Supplier deleted", name)
