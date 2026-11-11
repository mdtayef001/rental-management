"""What the business rents out, how much of it is on hand, and who it rents to.

Stock is counted, not serialised: 1,000 sewing machines are one Product with a quantity of
1,000 at a branch. A rental takes 100 of them out and brings some or all of them back.
"""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.accounts.models import Branch, TenantModel


class Product(TenantModel):
    """One kind of item the business rents out."""

    sku = models.CharField(max_length=64)
    # What a scanner reads. Blank is allowed: not every item carries a printed code, and
    # those are found by SKU or name instead.
    barcode = models.CharField(max_length=128, blank=True)
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    unit = models.CharField(max_length=30, default="pcs")
    description = models.TextField(blank=True)

    # Renting.
    rentable = models.BooleanField(default=True)
    rent_daily = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    rent_weekly = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    rent_monthly = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    # What replacing one costs, charged when an item comes back broken or doesn't come back.
    replacement_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])

    # What a unit cost to buy. Kept as a weighted average by the purchasing app, so changing
    # it never rewrites the profit on past rentals.
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])

    low_stock_threshold = models.PositiveIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["business", "sku"], name="unique_sku_per_business"),
            # Blank barcodes are exempt, so many products can have none.
            models.UniqueConstraint(
                fields=["business", "barcode"],
                condition=~models.Q(barcode=""),
                name="unique_barcode_per_business",
            ),
        ]
        indexes = [
            # The scanner's lookup: one indexed hit, whichever code was scanned.
            models.Index(fields=["business", "barcode"]),
            models.Index(fields=["business", "name"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.sku})"

    def rate_for(self, plan):
        """The product's own rate for a billing plan, or None when it has none set."""
        return {"daily": self.rent_daily, "weekly": self.rent_weekly, "monthly": self.rent_monthly}.get(plan)


class StockLevel(TenantModel):
    """How many of a product sit at a branch, ready to go out.

    `quantity` is what is physically on the shelf. Items out on rent are *not* counted here:
    renting takes them off, returning puts them back. How many are out is always derived from
    the open rental items, so the two numbers can never drift apart.
    """

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="stock")
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="stock")
    quantity = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "branch"], name="unique_stock_row")]
        indexes = [models.Index(fields=["business", "branch"])]

    def __str__(self):
        return f"{self.product_id} @ {self.branch_id}: {self.quantity}"


class StockMovement(TenantModel):
    """Every change to a stock level, with its reason. The stock ledger.

    Stock is never edited silently: a count that doesn't match the shelf can be traced back
    to the person and the reason.
    """

    class Reason(models.TextChoices):
        PURCHASE = "purchase", "Bought in"
        RENT_OUT = "rent_out", "Rented out"
        RENT_RETURN = "rent_return", "Returned from rent"
        SALE = "sale", "Sold"
        SALE_RETURN = "sale_return", "Sale returned"
        SUPPLIER_RETURN = "supplier_return", "Sent back to supplier"
        ADJUSTMENT = "adjustment", "Manual adjustment"
        DAMAGE = "damage", "Damaged or written off"
        LOST = "lost", "Lost"

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="movements")
    branch = models.ForeignKey(Branch, null=True, on_delete=models.SET_NULL, related_name="+")
    # Signed: positive adds to stock, negative takes away.
    change = models.IntegerField()
    # The level after this movement, so a ledger reads without re-adding everything.
    balance = models.PositiveIntegerField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.CharField(max_length=300, blank=True)
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-at", "-id"]
        indexes = [models.Index(fields=["business", "product", "-at"])]


class Customer(TenantModel):
    """Who the business rents to."""

    name = models.CharField(max_length=150)
    company = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    # National ID / passport / driving licence reference taken as security on a rental.
    id_type = models.CharField(max_length=40, blank=True)
    id_number = models.CharField(max_length=60, blank=True)
    notes = models.TextField(blank=True)
    # Set by the owner to stop new rentals going to someone (unpaid bills, lost items).
    blocked = models.BooleanField(default=False)
    blocked_reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["business", "name"]),
            models.Index(fields=["business", "phone"]),
        ]

    def __str__(self):
        return self.name


class CustomerRate(TenantModel):
    """A price agreed with one customer for one product.

    Every product has its own rate, which is what anyone pays by default. A company that
    rents all year usually has a price of its own, and staff shouldn't have to remember it:
    once it is written here, renting that product to that customer starts from this rate
    instead of the product's. It can still be changed on the day.
    """

    PLANS = [("daily", "Per day"), ("weekly", "Per week"), ("monthly", "Per month"), ("fixed", "Fixed price")]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="rates")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="customer_rates")
    plan = models.CharField(max_length=10, choices=PLANS, default="daily")
    rate = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["product__name", "plan"]
        constraints = [
            models.UniqueConstraint(fields=["customer", "product", "plan"], name="unique_customer_rate"),
        ]

    def __str__(self):
        return f"{self.customer_id} · {self.product_id} · {self.plan}: {self.rate}"
