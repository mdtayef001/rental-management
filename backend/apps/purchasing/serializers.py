"""Serializers for suppliers, purchases, supplier returns and payments."""

from rest_framework import serializers

from apps.accounts.models import Branch
from apps.api import IdField, tenant_field
from apps.catalog.models import Product

from .models import PaymentAllocation, Purchase, PurchaseItem, Supplier, SupplierPayment, SupplierReturn


class SupplierSerializer(serializers.ModelSerializer):
    id = IdField()
    # Annotated by the viewset when ?stats=1.
    purchase_count = serializers.IntegerField(read_only=True, required=False)
    total_bought = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True, required=False)
    balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True, required=False)

    class Meta:
        model = Supplier
        fields = ["id", "name", "company", "phone", "email", "address", "notes", "purchase_count", "total_bought", "balance", "created_at"]


class SupplierWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["name", "company", "phone", "email", "address", "notes"]


class PurchaseItemSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = IdField(source="product.id", default=None)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    quantity_returnable = serializers.IntegerField(read_only=True)

    class Meta:
        model = PurchaseItem
        fields = ["id", "product_id", "product_name", "quantity", "unit_cost", "amount", "quantity_returned", "quantity_returnable"]


class PurchaseSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    supplier_id = IdField(source="supplier.id", default=None)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default="")
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    items = PurchaseItemSerializer(many=True, read_only=True)
    due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    payment_status = serializers.CharField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.name", read_only=True, default="")

    class Meta:
        model = Purchase
        fields = [
            "id", "code", "supplier_id", "supplier_name", "branch_name", "reference", "note",
            "purchased_at", "total", "paid_amount", "due", "payment_status", "due_date", "is_overdue",
            "items", "created_by_name", "created_at",
        ]


class PurchaseLineSerializer(serializers.Serializer):
    product = tenant_field(Product)
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)


class PurchaseCreateSerializer(serializers.Serializer):
    supplier = tenant_field(Supplier, required=False, allow_null=True)
    branch = tenant_field(Branch)
    lines = PurchaseLineSerializer(many=True)
    purchased_at = serializers.DateTimeField(required=False, allow_null=True)
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, default=0)
    method = serializers.ChoiceField(choices=SupplierPayment.Method.choices, required=False, allow_blank=True, default="")
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate_lines(self, lines):
        if not lines:
            raise serializers.ValidationError("Add at least one product.")
        seen = set()
        for line in lines:
            if line["product"].pk in seen:
                raise serializers.ValidationError("The same product is on the bill twice. Put it on one line.")
            seen.add(line["product"].pk)
        return lines


class SupplierReturnSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    purchase_code = serializers.CharField(source="purchase.code", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default="")
    value = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    outstanding = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    units_to_replace = serializers.IntegerField(read_only=True)

    class Meta:
        model = SupplierReturn
        fields = [
            "id", "code", "purchase_code", "supplier_name", "product_name", "quantity", "unit_cost",
            "reason", "status", "replaced_quantity", "refunded_amount", "credited_amount",
            "value", "outstanding", "units_to_replace", "closed_note", "created_at", "finished_at",
        ]


class SupplierReturnCreateSerializer(serializers.Serializer):
    item = serializers.CharField()
    quantity = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=200)

    def validate_item(self, value):
        """Only a purchase item of the caller's own business."""
        if not str(value).isdigit():
            raise serializers.ValidationError("Not a valid purchase item.")
        business = self.context["request"].user.business
        item = (
            PurchaseItem.objects.filter(pk=int(value), purchase__business=business)
            .select_related("purchase", "product")
            .first()
        )
        if item is None:
            raise serializers.ValidationError("That item isn't on one of your purchases.")
        return item


class SettleReturnSerializer(serializers.Serializer):
    replaced_quantity = serializers.IntegerField(min_value=0, required=False, default=0)
    refunded_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, default=0)
    credited_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, default=0)
    close_note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate(self, data):
        if not any([data.get("replaced_quantity"), data.get("refunded_amount"), data.get("credited_amount"), data.get("close_note")]):
            raise serializers.ValidationError("Say how it was settled, or give a reason for closing it.")
        return data


class SupplierPaymentSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default="")
    allocations = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.name", read_only=True, default="")

    class Meta:
        model = SupplierPayment
        fields = ["id", "code", "supplier_name", "amount", "method", "paid_at", "note", "allocations", "created_by_name"]

    def get_allocations(self, payment):
        return [
            {"purchaseCode": a.purchase.code, "amount": a.amount}
            for a in payment.allocations.all()
        ]


class SupplierPaymentCreateSerializer(serializers.Serializer):
    supplier = tenant_field(Supplier)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    method = serializers.ChoiceField(choices=SupplierPayment.Method.choices, required=False, allow_blank=True, default="")
    # Leave out to pay the supplier's oldest unpaid bills first.
    purchase = tenant_field(Purchase, required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
