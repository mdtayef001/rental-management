"""Rentals, returns and receipts.

A Rental is one transaction with one customer: a customer renting 100 sewing machines and
20 tables gets ONE rental, with one code, one due date and one receipt. Each product is a
RentalItem on it, and items come back on their own schedule — 60 machines today, 40 next
week — so a rental is `active` until every item is fully back.

The money on a rental is only final at return, because the price depends on how long each
item was actually out. Rates and plans are frozen onto the item when it goes out, so
changing a product's price later never rewrites a past rental.
"""

import math
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.accounts.models import Branch, TenantModel
from apps.catalog.models import Customer, Product


def receipt_token():
    """Long and random, so a customer's receipt link can't be guessed from the rental number."""
    return secrets.token_urlsafe(16)


class Rental(TenantModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Out on rent"
        PARTLY_RETURNED = "partly_returned", "Partly returned"
        RETURNED = "returned", "Returned"
        CANCELLED = "cancelled", "Cancelled"

    # Open rentals: something is still out with the customer.
    OPEN = (Status.ACTIVE, Status.PARTLY_RETURNED)

    # Numbered 1, 2, 3… per business, shown as RN-000001.
    number = models.PositiveIntegerField()
    customer = models.ForeignKey(Customer, null=True, on_delete=models.SET_NULL, related_name="rentals")
    branch = models.ForeignKey(Branch, null=True, on_delete=models.SET_NULL, related_name="+")

    started_at = models.DateTimeField(default=timezone.now)
    # When everything is expected back. Optional: open-ended rentals are allowed when the
    # owner permits them. Indexed so overdue rentals are a query, never a table scan.
    due_at = models.DateTimeField(null=True, blank=True, db_index=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # When the last item came back.
    returned_at = models.DateTimeField(null=True, blank=True)

    # Running totals, kept on the row so lists and reports don't have to add up items.
    # `rent_total` is what the items have earned so far (final once everything is back).
    rent_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    late_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    damage_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    # Everything the customer has paid, less anything given back. Money paid in advance is
    # counted here from the moment it is taken, so the balance is negative — the shop is
    # holding their money — until the items come back and the rent is charged against it.
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes = models.TextField(blank=True)
    # For the customer's public receipt link.
    token = models.CharField(max_length=32, unique=True, default=receipt_token)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_rental_no_per_business")]
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["business", "-started_at"]),
            models.Index(fields=["business", "customer", "status"]),
        ]

    def __str__(self):
        return self.code

    @property
    def code(self):
        return f"RN-{self.number:06d}"

    @property
    def is_open(self):
        return self.status in self.OPEN

    @property
    def charges(self):
        """Everything charged on the rental so far, before payments."""
        return self.rent_total + self.late_fee + self.damage_fee - self.discount

    @property
    def credit(self):
        """Money the shop is holding for the customer: paid in advance and not yet used up."""
        return max(-self.balance, 0)

    @property
    def balance(self):
        """What the customer still owes. Negative means the business owes them back."""
        return self.charges - self.paid_amount

    @property
    def is_overdue(self):
        return self.is_open and self.due_at is not None and self.due_at < timezone.now()

    @property
    def days_late(self):
        """Days overdue, counting any started day — the same rule as `RentalItem.count_days`,
        so what the list shows is what the late fee is charged on."""
        if not self.is_overdue:
            return 0
        return RentalItem.count_days(self.due_at, timezone.now())

    @classmethod
    def overdue_q(cls):
        """Open and past due. Matches `isOverdue()` in the frontend."""
        return models.Q(status__in=cls.OPEN, due_at__lt=timezone.now())


class RentalItem(models.Model):
    """One product on a rental, with its own quantity, plan and rate.

    `quantity` is how many went out; `quantity_returned` is how many are back. The
    difference is what is still with the customer, which is what the return scanner
    looks for.
    """

    class Plan(models.TextChoices):
        DAILY = "daily", "Per day"
        WEEKLY = "weekly", "Per week"
        MONTHLY = "monthly", "Per month"
        FIXED = "fixed", "Fixed price"

    PLAN_DAYS = {Plan.DAILY: 1, Plan.WEEKLY: 7, Plan.MONTHLY: 30}

    rental = models.ForeignKey(Rental, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="rental_items")
    # Frozen at rent-out time, so the line still reads correctly after the product is
    # renamed or deleted.
    product_name = models.CharField(max_length=200)
    product_sku = models.CharField(max_length=64, blank=True)

    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    quantity_returned = models.PositiveIntegerField(default=0)
    # Units that never came back: broken beyond repair, or lost. Charged at replacement cost.
    quantity_lost = models.PositiveIntegerField(default=0)

    plan = models.CharField(max_length=10, choices=Plan.choices)
    # Price per day / week / month, or the flat amount when the plan is "fixed".
    rate = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    # What replacing one unit cost when the item went out.
    replacement_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # Days the business agreed not to charge for (the shop was shut, the item was faulty).
    # Only reduces a per-day plan.
    holidays = models.PositiveIntegerField(default=0)

    # Filled in as the item comes back. `days_out` is the billed length of the last return.
    days_out = models.PositiveIntegerField(null=True, blank=True)
    # What this line has earned so far, added up over however many returns it took.
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    returned_at = models.DateTimeField(null=True, blank=True)

    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            # The return scanner's query: open items for a product, newest first.
            models.Index(fields=["product", "quantity_returned"]),
        ]

    def __str__(self):
        return f"{self.quantity} × {self.product_name}"

    @property
    def quantity_out(self):
        """Still with the customer, and so still returnable."""
        return max(self.quantity - self.quantity_returned - self.quantity_lost, 0)

    @property
    def is_open(self):
        return self.quantity_out > 0

    # ---------- Pricing ----------
    #
    # Identical arithmetic lives in frontend/src/lib/rental.ts, so the price staff see while
    # filling the form is the price the server charges. Both are covered by tests.

    @classmethod
    def quote(cls, plan, rate, days, quantity, holidays=0):
        """What `quantity` units cost for `days` days on `plan`.

        Per day: the days, less holidays. Weekly and monthly: every *started* period, so 10
        days on a weekly plan is 2 weeks (holidays don't apply to them). Fixed: one price,
        however long it was out.
        """
        quantity = max(int(quantity or 1), 1)
        days = max(int(days or 1), 1)
        rate = rate or 0

        if plan == cls.Plan.FIXED:
            return rate * quantity
        if plan == cls.Plan.DAILY:
            return max(days - max(int(holidays or 0), 0), 0) * rate * quantity
        periods = math.ceil(days / cls.PLAN_DAYS[plan])
        return periods * rate * quantity

    @staticmethod
    def count_days(start, end):
        """Days out, counting any started day: out at 10:00 and back at 10:00 the next day is
        1 day; back at 11:00 the next day is 2. Never less than 1."""
        return max(1, math.ceil((end - start).total_seconds() / 86400))

    def quote_now(self, quantity=None, at=None, holidays=None):
        """What returning `quantity` units right now would add to this line."""
        at = at or timezone.now()
        days = self.count_days(self.rental.started_at, at)
        return self.quote(
            self.plan,
            self.rate,
            days,
            quantity if quantity is not None else self.quantity_out,
            self.holidays if holidays is None else holidays,
        )


class RentalReturn(TenantModel):
    """One act of taking items back. A rental can have several.

    Keeping each return as its own row is what makes partial returns honest: the receipt for
    the 60 machines that came back on Tuesday shows Tuesday's charges, and the 40 still out
    are billed from the day they actually come back.
    """

    # Numbered 1, 2, 3… per business, shown as RT-000001.
    number = models.PositiveIntegerField()
    rental = models.ForeignKey(Rental, on_delete=models.CASCADE, related_name="returns")
    at = models.DateTimeField(default=timezone.now)

    # What this return charged, totalled from its lines.
    rent_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    late_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    damage_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    # Taken from the customer at this return, and any unused advance handed back at it.
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    refunded = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE = "mobile", "Mobile banking"
        CARD = "card", "Card"
        BANK = "bank", "Bank transfer"

    payment_method = models.CharField(max_length=10, choices=Method.choices, blank=True)
    # The bKash / Nagad transaction id staff copy from the customer's payment.
    payment_reference = models.CharField(max_length=60, blank=True)

    note = models.CharField(max_length=300, blank=True)
    # For the customer's public receipt link for this return.
    token = models.CharField(max_length=32, unique=True, default=receipt_token)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_return_no_per_business")]
        indexes = [models.Index(fields=["business", "-at"])]

    def __str__(self):
        return self.code

    @property
    def code(self):
        return f"RT-{self.number:06d}"

    @property
    def charges(self):
        return self.rent_total + self.late_fee + self.damage_fee - self.discount


class RentalReturnLine(models.Model):
    """How many of one rental item came back in one return, and what it cost."""

    class Condition(models.TextChoices):
        GOOD = "good", "Good"
        DAMAGED = "damaged", "Damaged"
        LOST = "lost", "Not returned"

    rental_return = models.ForeignKey(RentalReturn, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(RentalItem, on_delete=models.CASCADE, related_name="return_lines")

    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    condition = models.CharField(max_length=10, choices=Condition.choices, default=Condition.GOOD)
    # Days billed for this return, after holidays.
    days_out = models.PositiveIntegerField()
    holidays = models.PositiveIntegerField(default=0)
    rent_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    late_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Charged for damaged or unreturned units.
    damage_fee = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["id"]

    @property
    def total(self):
        return self.rent_amount + self.late_fee + self.damage_fee


class RentalPayment(TenantModel):
    """Money taken against a rental: at rent-out, at a return, or any time in between."""

    rental = models.ForeignKey(Rental, on_delete=models.CASCADE, related_name="payments")
    rental_return = models.ForeignKey(RentalReturn, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    # Positive is money in from the customer; negative is money given back to them.
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    method = models.CharField(max_length=10, choices=RentalReturn.Method.choices, blank=True)
    reference = models.CharField(max_length=60, blank=True)

    class Kind(models.TextChoices):
        # Paid when the items went out, before any rent was charged.
        ADVANCE = "advance", "Paid in advance"
        RENT = "rent", "Payment"
        REFUND = "refund", "Given back"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    note = models.CharField(max_length=300, blank=True)
    at = models.DateTimeField(default=timezone.now)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["at", "id"]
        indexes = [models.Index(fields=["business", "-at"])]
