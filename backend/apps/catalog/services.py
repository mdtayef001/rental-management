"""Stock arithmetic and product lookup.

Every change to a stock level goes through `change_stock`, which locks the row, refuses to
go negative and writes a ledger entry. Nothing else is allowed to touch
`StockLevel.quantity`, so "where did those 40 machines go" always has an answer.
"""

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import log

from .models import Customer, CustomerRate, Product, StockLevel, StockMovement


@transaction.atomic
def change_stock(*, product, branch, change, reason, user=None, note=""):
    """Add to or take from the stock of `product` at `branch`. Returns the new level.

    `select_for_update` is what makes two staff members returning items at the same moment
    safe: the second waits for the first, so both changes land instead of one overwriting
    the other.
    """
    if change == 0:
        return StockLevel.objects.filter(product=product, branch=branch).first()

    level, _ = StockLevel.objects.select_for_update().get_or_create(
        product=product, branch=branch, defaults={"business_id": product.business_id, "quantity": 0}
    )
    new_quantity = level.quantity + change
    if new_quantity < 0:
        raise ValidationError(
            f"Only {level.quantity} {product.unit} of {product.name} are at {branch.name}; "
            f"you asked for {abs(change)}."
        )
    level.quantity = new_quantity
    level.save(update_fields=["quantity"])

    StockMovement.objects.create(
        business_id=product.business_id,
        product=product,
        branch=branch,
        change=change,
        balance=new_quantity,
        reason=reason,
        note=note[:300],
        by=user if user and user.pk else None,
    )
    return level


@transaction.atomic
def adjust_stock(*, user, product, branch, quantity, reason, note=""):
    """A manual correction: set the shelf count to `quantity`, whatever it was before.

    Staff count the shelf and type what they see; the ledger records the difference and who
    said so. A reason is required, because an unexplained correction is how stock quietly
    goes missing.
    """
    if reason not in (StockMovement.Reason.ADJUSTMENT, StockMovement.Reason.DAMAGE, StockMovement.Reason.LOST):
        raise ValidationError("Pick a reason: a correction, damage, or lost stock.")
    level, _ = StockLevel.objects.select_for_update().get_or_create(
        product=product, branch=branch, defaults={"business_id": product.business_id, "quantity": 0}
    )
    change = quantity - level.quantity
    if change == 0:
        return level
    level = change_stock(product=product, branch=branch, change=change, reason=reason, user=user, note=note)
    log(user, "Stock adjusted", f"{product.name} at {branch.name}: {change:+d} → {quantity} ({note or reason})")
    return level


def availability(product, branch=None):
    """How many are free to rent out right now, per branch or at one branch.

    This is just the stock on hand: renting takes items off the shelf and returning puts
    them back, so what's on the shelf is exactly what can go out. Nothing has to be
    subtracted for rentals already running.
    """
    rows = StockLevel.objects.filter(product=product)
    if branch is not None:
        rows = rows.filter(branch=branch)
        return rows.values_list("quantity", flat=True).first() or 0
    return {str(branch_id): qty for branch_id, qty in rows.values_list("branch_id", "quantity")}


def total_on_hand(product):
    return StockLevel.objects.filter(product=product).aggregate(n=Sum("quantity"))["n"] or 0


def find_by_code(business, code, *, rentable_only=False):
    """Resolve a scanned or typed code to one product.

    Barcode first, then SKU, because a scanner reads a barcode and a person types a SKU. A
    QR code the business printed itself may carry a `sku:` or `product:` prefix, which is
    stripped before looking up. Returns None when nothing matches.
    """
    code = (code or "").strip()
    if not code:
        return None
    # Our own printed QR labels, and the odd scanner that prepends a URL.
    for prefix in ("sku:", "product:", "p:"):
        if code.lower().startswith(prefix):
            code = code[len(prefix):].strip()
            break
    if "/" in code and code.lower().startswith(("http://", "https://")):
        code = code.rstrip("/").rsplit("/", 1)[-1]

    qs = Product.objects.filter(business=business, archived_at__isnull=True)
    if rentable_only:
        qs = qs.filter(rentable=True)
    # Both columns are indexed per business, so this is one hit either way.
    return qs.filter(Q(barcode__iexact=code) | Q(sku__iexact=code)).first()


def search_products(business, text, *, rentable_only=False, limit=20):
    """Name / SKU / barcode search, for when a code doesn't scan or isn't known."""
    text = (text or "").strip()
    qs = Product.objects.filter(business=business, archived_at__isnull=True)
    if rentable_only:
        qs = qs.filter(rentable=True)
    if text:
        qs = qs.filter(Q(name__icontains=text) | Q(sku__icontains=text) | Q(barcode__icontains=text))
    return qs.order_by("name")[:limit]


def next_sku(business):
    """A SKU for a product added without one: P-0001, P-0002, … skipping any already taken."""
    taken = set(
        Product.objects.filter(business=business, sku__istartswith="P-").values_list("sku", flat=True)
    )
    taken = {sku.upper() for sku in taken}
    number = len(taken) + 1
    while f"P-{number:04d}" in taken:
        number += 1
    return f"P-{number:04d}"


@transaction.atomic
def create_product(*, user, opening_stock=0, branch=None, **fields):
    """Add a product, optionally with the count already on the shelf.

    `opening_stock` goes onto `branch` (the business's first when none is given) through
    the stock ledger like any other change, so the first line of the product's history says
    where its stock came from.
    """
    from apps.accounts.models import Business

    if not (fields.get("sku") or "").strip():
        # Numbered under the business lock, so two people adding products at once can't be
        # handed the same SKU.
        Business.objects.select_for_update().filter(pk=user.business_id).first()
        fields["sku"] = next_sku(user.business)
    product = Product.objects.create(business=user.business, created_by=user, **fields)
    if opening_stock:
        branch = branch or user.business.branches.first()
        if branch is not None:
            change_stock(
                product=product, branch=branch, change=int(opening_stock),
                reason=StockMovement.Reason.ADJUSTMENT, user=user, note="Opening stock",
            )
    log(user, "Product added", f"{product.name} ({product.sku})")
    return product


@transaction.atomic
def delete_product(*, user, product):
    """Remove a product from the catalogue.

    A product nobody has ever used — a typo, a line that was never stocked — is deleted
    outright, because leaving it archived would mean a mistake can never be tidied away.

    One with any history is archived instead. Deleting it would be deleting the past: a
    rental from last year, the stock ledger. The lines themselves keep
    their own copy of the name and SKU, so a receipt still reads correctly either way; what
    archiving protects is everything that still points at the row — the stock history, and
    the product page a receipt's figures can be traced back to.

    Either way it is refused while units are out on rent, so an item cannot vanish from the
    catalogue while a customer still has it.
    """
    from apps.rentals.models import Rental, RentalItem

    out = (
        RentalItem.objects.filter(product=product, rental__status__in=Rental.OPEN)
        .exclude(quantity=F("quantity_returned") + F("quantity_lost"))
        .exists()
    )
    if out:
        raise ValidationError("Some of these are still out on rent. Take them back first.")

    name = f"{product.name} ({product.sku})"
    used = (
        RentalItem.objects.filter(product=product).exists()
        or StockMovement.objects.filter(product=product).exists()
    )
    if not used:
        # Stock rows are the product's own counters, not history, so they go with it.
        StockLevel.objects.filter(product=product).delete()
        product.delete()
        log(user, "Product deleted", name)
        return False

    product.archived_at = timezone.now()
    product.save(update_fields=["archived_at"])
    log(user, "Product archived", name)
    return True


@transaction.atomic
def create_customer(*, user, **fields):
    customer = Customer.objects.create(business=user.business, created_by=user, **fields)
    log(user, "Customer added", customer.name)
    return customer


@transaction.atomic
def delete_customer(*, user, customer):
    """Remove a customer from the list. Returns True if they were archived, not deleted.

    Refused while they still have something out, so nobody loses track of who has what.

    Someone who never rented — a typo, a duplicate — is deleted outright. Anyone with a
    rental behind them is archived instead: they leave the customer list and can't be
    rented to, but their rentals, bills, receipts and the reports still carry their name.
    Deleting them would turn every one of those into an anonymous rental.
    """
    from apps.rentals.models import Rental

    if customer.rentals.filter(status__in=Rental.OPEN).exists():
        raise ValidationError("This customer still has items out on rent.")
    name = customer.name
    if not customer.rentals.exists():
        customer.delete()
        log(user, "Customer deleted", name)
        return False

    customer.archived_at = timezone.now()
    customer.save(update_fields=["archived_at"])
    log(user, "Customer archived", name)
    return True


# ---------- A customer's own prices ----------


def customer_rate(customer, product, plan):
    """The price agreed with this customer for this product and plan, or None."""
    if customer is None:
        return None
    return (
        CustomerRate.objects.filter(customer=customer, product=product, plan=plan)
        .values_list("rate", flat=True)
        .first()
    )


def set_customer_rate(*, user, customer, product, plan, rate, quiet=False):
    """Agree a price with a customer, change it, or (with `rate=None`) go back to the
    product's own.

    A price equal to the product's own rate is not stored: it would only freeze today's
    default onto the customer, so they'd miss the next price change for no reason.
    """
    existing = CustomerRate.objects.filter(customer=customer, product=product, plan=plan).first()
    if rate is not None and rate == product.rate_for(plan):
        rate = None

    if rate is None:
        if existing:
            existing.delete()
            if not quiet:
                log(user, "Customer price removed", f"{customer.name} · {product.name}")
        return None

    if existing and existing.rate == rate:
        return existing
    saved, _ = CustomerRate.objects.update_or_create(
        customer=customer,
        product=product,
        plan=plan,
        defaults={"business": customer.business, "rate": rate, "updated_by": user},
    )
    log(user, "Customer price set", f"{customer.name} · {product.name} · {rate} ({plan})")
    return saved
