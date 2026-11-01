"""Buying stock in: suppliers, their bills, and what the business owes them.

Recording a purchase does two things: it raises the stock at a branch, and it moves the
product's `cost` to the weighted average of what was already on hand and what was just
paid. The average is what makes profit honest — selling or renting out an item bought at
two different prices shouldn't depend on which physical unit left the shelf.
"""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.accounts.models import Branch, TenantModel
from apps.catalog.models import Product


class Supplier(TenantModel):
    name = models.CharField(max_length=150)
    company = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["business", "name"])]

    def __str__(self):
        return self.name


class Purchase(TenantModel):
    """One supplier's bill: one or more products, received at one branch.

    The links from purchases to suppliers and payments are RESTRICT rather than CASCADE: a
    supplier with bills against them can't be deleted out from under the history, but
    deleting the whole business still takes everything with it.
    """

    # Numbered 1, 2, 3… per business. Shown as P-000001.
    number = models.PositiveIntegerField()
    # Optional: stock bought at a market stall has no supplier worth keeping.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="purchases")
    branch = models.ForeignKey(Branch, null=True, on_delete=models.SET_NULL, related_name="+")
    # The supplier's own invoice number.
    reference = models.CharField(max_length=60, blank=True)
    note = models.CharField(max_length=300, blank=True)
    purchased_at = models.DateTimeField(default=timezone.now)
    # The bill's total, stored so what's owed can be filtered and added up in the database.
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Paid at the till plus any payments allocated to it later.
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # When the rest is due, for stock bought on credit.
    due_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-purchased_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_purchase_no_per_business")]
        indexes = [models.Index(fields=["business", "-purchased_at"])]

    def __str__(self):
        return self.code

    @property
    def code(self):
        return f"P-{self.number:06d}"

    @property
    def due(self):
        return max(self.total - self.paid_amount, 0)

    @property
    def payment_status(self):
        """paid | partly_paid | unpaid"""
        if self.paid_amount >= self.total:
            return "paid"
        return "partly_paid" if self.paid_amount > 0 else "unpaid"

    @property
    def is_overdue(self):
        return bool(self.due_date and self.due > 0 and self.due_date < timezone.localdate())


class PurchaseItem(models.Model):
    """One product on a purchase, at the price actually paid for it."""

    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    # Frozen, so deleting the product later doesn't empty the record.
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    # How many of these have gone back to the supplier, so a return can't exceed the bill.
    quantity_returned = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["id"]

    @property
    def amount(self):
        return self.unit_cost * self.quantity

    @property
    def quantity_returnable(self):
        return max(self.quantity - self.quantity_returned, 0)


class SupplierReturn(TenantModel):
    """Stock from a purchase sent back, usually faulty.

    It leaves stock straight away. The supplier settles by sending replacements, refunding
    the money, or crediting what the business owes them; the owner can also close it
    unsettled and take the loss.
    """

    class Status(models.TextChoices):
        OPEN = "open", "Waiting for supplier"
        SETTLED = "settled", "Settled"
        CLOSED = "closed", "Closed unsettled"

    # Numbered per business. Shown as SR-000001.
    number = models.PositiveIntegerField()
    purchase = models.ForeignKey(Purchase, on_delete=models.RESTRICT, related_name="returns")
    item = models.ForeignKey(PurchaseItem, on_delete=models.RESTRICT, related_name="returns")
    # Copied from the purchase so lists and totals don't have to join through it.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="returns")
    branch = models.ForeignKey(Branch, null=True, on_delete=models.SET_NULL, related_name="+")
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    # What was paid per unit on the purchase: what the supplier owes back for each.
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    # How far it has been settled.
    replaced_quantity = models.PositiveIntegerField(default=0)
    refunded_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credited_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closed_note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_supplier_return_no_per_business")]

    def __str__(self):
        return self.code

    @property
    def code(self):
        return f"SR-{self.number:06d}"

    @property
    def value(self):
        return self.unit_cost * self.quantity

    @property
    def outstanding(self):
        """What the supplier still owes: the value less replacements, refunds and credits."""
        settled = self.unit_cost * self.replaced_quantity + self.refunded_amount + self.credited_amount
        return max(self.value - settled, 0)

    @property
    def units_to_replace(self):
        """How many more units the supplier could send instead of money."""
        left = self.quantity - self.replaced_quantity
        if self.unit_cost <= 0:
            return left
        return min(left, int(self.outstanding // self.unit_cost))


class SupplierPayment(TenantModel):
    """Money paid to a supplier, allocated across their bills.

    A return taken off what's owed is a payment too, with the method "credit", so one
    statement shows everything that moved the balance.
    """

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE = "mobile", "Mobile banking"
        BANK = "bank", "Bank"
        CREDIT = "credit", "Return credit"

    # Numbered per business. Shown as SP-000001.
    number = models.PositiveIntegerField()
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(0)])
    method = models.CharField(max_length=10, choices=Method.choices, blank=True)
    paid_at = models.DateTimeField(default=timezone.now)
    note = models.CharField(max_length=300, blank=True)
    # For a return credit: the return it came from.
    supplier_return = models.ForeignKey(SupplierReturn, null=True, blank=True, on_delete=models.RESTRICT, related_name="credits")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_supplier_payment_no_per_business")]
        indexes = [models.Index(fields=["business", "-paid_at"])]

    def __str__(self):
        return self.code

    @property
    def code(self):
        return f"SP-{self.number:06d}"


class PaymentAllocation(models.Model):
    """The part of one payment that went to one purchase."""

    payment = models.ForeignKey(SupplierPayment, on_delete=models.CASCADE, related_name="allocations")
    purchase = models.ForeignKey(Purchase, on_delete=models.RESTRICT, related_name="allocations")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["id"]
