"""Serializers for products, stock and customers."""

from rest_framework import serializers

from apps.accounts.models import Branch
from apps.api import IdField, tenant_field

from .models import Customer, Product, StockLevel, StockMovement

PRODUCT_FIELDS = [
    "sku", "barcode", "name", "category", "unit", "description",
    "rentable", "rent_daily", "rent_weekly", "rent_monthly", "deposit", "replacement_cost",
    "sellable", "price", "low_stock_threshold",
]


class ProductSerializer(serializers.ModelSerializer):
    """A product with its stock per branch.

    `stock` is a map of branch id to quantity, annotated by the viewset so a page of 50
    products costs two queries rather than 51.
    """

    id = IdField()
    stock = serializers.SerializerMethodField()
    on_hand = serializers.IntegerField(read_only=True, default=0)
    out_on_rent = serializers.IntegerField(read_only=True, default=0)
    cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Product
        fields = ["id", *PRODUCT_FIELDS, "cost", "stock", "on_hand", "out_on_rent", "archived_at", "created_at"]

    def get_stock(self, product):
        # Prefetched by the viewset.
        return {str(level.branch_id): level.quantity for level in product.stock.all()}


class ProductWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = PRODUCT_FIELDS

    def validate_sku(self, sku):
        sku = sku.strip()
        if not sku:
            raise serializers.ValidationError("A SKU is required.")
        business = self.context["request"].user.business
        clash = Product.objects.filter(business=business, sku__iexact=sku)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another product already uses that SKU.")
        return sku

    def validate_barcode(self, barcode):
        barcode = barcode.strip()
        if not barcode:
            return ""
        business = self.context["request"].user.business
        clash = Product.objects.filter(business=business, barcode__iexact=barcode)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another product already uses that barcode.")
        return barcode

    def validate(self, data):
        """A rentable product needs at least one rate, or staff would have nothing to charge."""
        merged = {**(self.instance.__dict__ if self.instance else {}), **data}
        if merged.get("rentable") and not any(merged.get(f) for f in ("rent_daily", "rent_weekly", "rent_monthly")):
            raise serializers.ValidationError(
                {"rentDaily": "Set at least one rental rate (per day, week or month)."}
            )
        return data


class StockLevelSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = IdField(source="product.id")
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    branch_id = IdField(source="branch.id")
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    low = serializers.BooleanField(read_only=True, default=False)

    class Meta:
        model = StockLevel
        fields = ["id", "product_id", "product_name", "product_sku", "branch_id", "branch_name", "quantity", "low"]


class StockAdjustSerializer(serializers.Serializer):
    """Setting a shelf count to what was actually counted."""

    product = tenant_field(Product, write_only=True)
    branch = tenant_field(Branch, write_only=True)
    quantity = serializers.IntegerField(min_value=0)
    reason = serializers.ChoiceField(
        choices=[
            StockMovement.Reason.ADJUSTMENT,
            StockMovement.Reason.DAMAGE,
            StockMovement.Reason.LOST,
        ]
    )
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_branch(self, branch):
        """Staff can only correct stock at a branch they work at."""
        allowed = self.context["request"].user.branch_ids()
        if allowed is not None and branch.id not in allowed:
            raise serializers.ValidationError("You don't work at that branch.")
        return branch


class StockMovementSerializer(serializers.ModelSerializer):
    id = IdField()
    product_name = serializers.CharField(source="product.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    by_name = serializers.CharField(source="by.name", read_only=True, default="")

    class Meta:
        model = StockMovement
        fields = ["id", "at", "product_name", "branch_name", "change", "balance", "reason", "note", "by_name"]


class CustomerSerializer(serializers.ModelSerializer):
    id = IdField()
    # Annotated by the viewset when ?stats=1.
    open_rental_count = serializers.IntegerField(read_only=True, required=False)
    rental_count = serializers.IntegerField(read_only=True, required=False)
    balance_due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True, required=False)

    class Meta:
        model = Customer
        fields = [
            "id", "name", "company", "phone", "email", "address",
            "id_type", "id_number", "notes", "blocked", "blocked_reason",
            "open_rental_count", "rental_count", "balance_due", "created_at",
        ]


class CustomerWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["name", "company", "phone", "email", "address", "id_type", "id_number", "notes", "blocked", "blocked_reason"]

    def validate_name(self, name):
        name = name.strip()
        if not name:
            raise serializers.ValidationError("A name is required.")
        return name


class LookupSerializer(serializers.Serializer):
    """What the scanner gets back for one scanned code.

    Deliberately small: the scan screen needs the product, what it costs to rent and how
    many are free at each branch — nothing else, because this runs on every scan.
    """

    id = serializers.CharField()
    sku = serializers.CharField()
    barcode = serializers.CharField()
    name = serializers.CharField()
    unit = serializers.CharField()
    category = serializers.CharField()
    rentable = serializers.BooleanField()
    sellable = serializers.BooleanField()
    rent_daily = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    rent_weekly = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    rent_monthly = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    deposit = serializers.DecimalField(max_digits=12, decimal_places=2)
    replacement_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    price = serializers.DecimalField(max_digits=12, decimal_places=2)
    stock = serializers.DictField(child=serializers.IntegerField())
    on_hand = serializers.IntegerField()

    @staticmethod
    def of(product, stock):
        return {
            "id": str(product.id),
            "sku": product.sku,
            "barcode": product.barcode,
            "name": product.name,
            "unit": product.unit,
            "category": product.category,
            "rentable": product.rentable,
            "sellable": product.sellable,
            "rent_daily": product.rent_daily,
            "rent_weekly": product.rent_weekly,
            "rent_monthly": product.rent_monthly,
            "deposit": product.deposit,
            "replacement_cost": product.replacement_cost,
            "price": product.price,
            "stock": stock,
            "on_hand": sum(stock.values()),
        }
