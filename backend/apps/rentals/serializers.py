"""Serializers for rentals, returns and receipts."""

from rest_framework import serializers

from apps.accounts.models import Branch
from apps.api import IdField, tenant_field
from apps.catalog.models import Customer, Product

from .models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine


class RentalItemSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = IdField(source="product.id", default=None)
    quantity_out = serializers.IntegerField(read_only=True)

    class Meta:
        model = RentalItem
        fields = [
            "id", "product_id", "product_name", "product_sku",
            "quantity", "quantity_returned", "quantity_lost", "quantity_out",
            "plan", "rate", "replacement_cost",
            "holidays", "days_out", "line_total", "returned_at", "note",
        ]


class RentalListSerializer(serializers.ModelSerializer):
    """A rental as a list row: no items, so a page of 50 stays one query."""

    id = IdField()
    code = serializers.CharField(read_only=True)
    customer_id = IdField(source="customer.id", default=None)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default="Walk-in")
    customer_phone = serializers.CharField(source="customer.phone", read_only=True, default="")
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    charges = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    days_late = serializers.IntegerField(read_only=True)
    # Annotated by the viewset.
    item_count = serializers.IntegerField(read_only=True, default=0)
    units_out = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Rental
        fields = [
            "id", "code", "status", "customer_id", "customer_name", "customer_phone", "branch_name",
            "started_at", "due_at", "returned_at",
            "rent_total", "late_fee", "damage_fee", "discount", "paid_amount",
            "charges", "balance", "is_overdue", "days_late", "item_count", "units_out", "notes", "created_at",
        ]


class RentalPaymentSerializer(serializers.ModelSerializer):
    id = IdField()
    by_name = serializers.CharField(source="by.name", read_only=True, default="")

    class Meta:
        model = RentalPayment
        fields = ["id", "amount", "kind", "method", "reference", "note", "at", "by_name"]


class RentalReturnLineSerializer(serializers.ModelSerializer):
    id = IdField()
    item_id = IdField(source="item.id")
    product_name = serializers.CharField(source="item.product_name", read_only=True)
    total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = RentalReturnLine
        fields = [
            "id", "item_id", "product_name", "quantity", "condition",
            "days_out", "holidays", "rent_amount", "late_fee", "damage_fee", "total", "note",
        ]


class RentalReturnSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    rental_id = IdField(source="rental.id")
    rental_code = serializers.CharField(source="rental.code", read_only=True)
    customer_name = serializers.CharField(source="rental.customer.name", read_only=True, default="Walk-in")
    lines = RentalReturnLineSerializer(many=True, read_only=True)
    charges = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    by_name = serializers.CharField(source="by.name", read_only=True, default="")

    class Meta:
        model = RentalReturn
        fields = [
            "id", "code", "rental_id", "rental_code", "customer_name", "at",
            "rent_total", "late_fee", "damage_fee", "discount", "charges",
            "paid_amount", "refunded", "payment_method", "payment_reference",
            "note", "token", "lines", "by_name",
        ]


class RentalSerializer(RentalListSerializer):
    """One rental in full: items, returns and payments."""

    items = RentalItemSerializer(many=True, read_only=True)
    returns = RentalReturnSerializer(many=True, read_only=True)
    payments = RentalPaymentSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(source="created_by.name", read_only=True, default="")

    class Meta(RentalListSerializer.Meta):
        fields = [*RentalListSerializer.Meta.fields, "items", "returns", "payments", "token", "created_by_name"]


# ---------- Writing ----------


class RentalLineSerializer(serializers.Serializer):
    """One product going out on a rental."""

    product = tenant_field(Product)
    quantity = serializers.IntegerField(min_value=1)
    plan = serializers.ChoiceField(choices=RentalItem.Plan.choices)
    # Left out to use the product's own rate for the plan.
    rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, allow_null=True)
    replacement_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, allow_null=True)
    holidays = serializers.IntegerField(min_value=0, required=False, default=0)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class RentalCreateSerializer(serializers.Serializer):
    customer = tenant_field(Customer, required=False, allow_null=True)
    branch = tenant_field(Branch)
    lines = RentalLineSerializer(many=True)
    started_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    # Paid in advance, before anything has been charged.
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, default=0)
    payment_method = serializers.ChoiceField(choices=RentalReturn.Method.choices, required=False, allow_blank=True, default="")
    payment_reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    # Keep the rates typed on this rental as the customer's prices from now on.
    remember_rates = serializers.BooleanField(required=False, default=False)

    def validate_lines(self, lines):
        if not lines:
            raise serializers.ValidationError("Add at least one product.")
        if len(lines) > 100:
            raise serializers.ValidationError("That's more than 100 products on one rental. Split it up.")
        return lines

    def validate_branch(self, branch):
        allowed = self.context["request"].user.branch_ids()
        if allowed is not None and branch.id not in allowed:
            raise serializers.ValidationError("You don't work at that branch.")
        return branch


class ReturnLineSerializer(serializers.Serializer):
    """How many of one rental item are coming back, and in what state."""

    item = serializers.CharField()
    quantity = serializers.IntegerField(min_value=1)
    condition = serializers.ChoiceField(choices=RentalReturnLine.Condition.choices, default=RentalReturnLine.Condition.GOOD)
    holidays = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_item(self, value):
        """Resolve the item id, but only within the rental being returned.

        The rental comes from the URL, so an item id belonging to someone else's rental is
        rejected here rather than quietly returning another customer's goods.
        """
        rental = self.context["rental"]
        if not str(value).isdigit():
            raise serializers.ValidationError("Not a valid item.")
        item = RentalItem.objects.filter(pk=int(value), rental=rental).select_related("product").first()
        if item is None:
            raise serializers.ValidationError("That item isn't on this rental.")
        return item


class ReturnCreateSerializer(serializers.Serializer):
    lines = ReturnLineSerializer(many=True)
    at = serializers.DateTimeField(required=False, allow_null=True)
    discount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, default=0)
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, default=0)
    # Unused advance handed back at this return.
    refunded = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, default=0)
    payment_method = serializers.ChoiceField(choices=RentalReturn.Method.choices, required=False, allow_blank=True, default="")
    payment_reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_lines(self, lines):
        if not lines:
            raise serializers.ValidationError("Say what is coming back.")
        seen = set()
        for line in lines:
            if line["item"].pk in seen:
                raise serializers.ValidationError("The same item is listed twice. Put it on one line.")
            seen.add(line["item"].pk)
        return lines


class ResolveReturnSerializer(serializers.Serializer):
    """What the return scanner sends: a scanned code, or a customer or rental to list."""

    code = serializers.CharField(required=False, allow_blank=True, default="")
    customer = tenant_field(Customer, required=False, allow_null=True)
    rental = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, data):
        if not (data.get("code") or data.get("customer") or data.get("rental")):
            raise serializers.ValidationError("Scan a code, or pick a customer or rental.")
        return data


class PaymentCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    method = serializers.ChoiceField(choices=RentalReturn.Method.choices, required=False, allow_blank=True, default="")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class QuoteSerializer(serializers.Serializer):
    """Priced before anything is saved, so staff can tell the customer the cost up front."""

    plan = serializers.ChoiceField(choices=RentalItem.Plan.choices)
    rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    days = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, default=1)
    holidays = serializers.IntegerField(min_value=0, default=0)
