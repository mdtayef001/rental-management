"""Serializers for products, stock and customers."""

from rest_framework import serializers

from apps.accounts.models import Branch
from apps.api import IdField, tenant_field

from .models import Customer, CustomerRate, Product, StockLevel, StockMovement

PRODUCT_FIELDS = [
    "sku", "barcode", "name", "category", "unit", "description",
    "rentable", "rent_daily", "rent_weekly", "rent_monthly", "replacement_cost",
    "low_stock_threshold",
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

    class Meta:
        model = Product
        fields = ["id", *PRODUCT_FIELDS, "stock", "on_hand", "out_on_rent", "archived_at", "created_at"]

    def get_stock(self, product):
        # Prefetched by the viewset.
        return {str(level.branch_id): level.quantity for level in product.stock.all()}


class ProductWriteSerializer(serializers.ModelSerializer):
    """Adding or changing a product.

    Only the name and one rate are really needed. The SKU can be left empty and is then
    numbered for them, and a new product can be given the count on the shelf in the same
    step, so "add a product" is one form rather than a form and a stock correction.
    """

    sku = serializers.CharField(max_length=64, required=False, allow_blank=True)
    # New products only: how many are on the shelf today.
    opening_stock = serializers.IntegerField(min_value=0, max_value=10_000_000, required=False, write_only=True)

    class Meta:
        model = Product
        fields = [*PRODUCT_FIELDS, "opening_stock"]

    def validate_sku(self, sku):
        sku = sku.strip()
        if not sku:
            # Left empty: `create_product` numbers it. An existing product keeps its own.
            return self.instance.sku if self.instance else ""
        business = self.context["request"].user.business
        # Only among products still in the catalogue: an archived one's code is free again.
        clash = Product.objects.filter(business=business, sku__iexact=sku, archived_at__isnull=True)
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
        clash = Product.objects.filter(business=business, barcode__iexact=barcode, archived_at__isnull=True)
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
        if self.instance:
            # Stock on an existing product only ever changes through the stock ledger.
            data.pop("opening_stock", None)
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
            "open_rental_count", "rental_count", "balance_due", "archived_at", "created_at",
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


class CustomerRateSerializer(serializers.ModelSerializer):
    """One price agreed with a customer, beside the product's own so the two can be compared."""

    id = IdField()
    product_id = IdField(source="product.id")
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    default_rate = serializers.SerializerMethodField()

    class Meta:
        model = CustomerRate
        fields = ["id", "product_id", "product_name", "product_sku", "plan", "rate", "default_rate", "updated_at"]

    def get_default_rate(self, rate):
        return rate.product.rate_for(rate.plan)


class CustomerRateWriteSerializer(serializers.Serializer):
    product = tenant_field(Product)
    plan = serializers.ChoiceField(choices=CustomerRate.PLANS, default="daily")
    # Null puts the customer back on the product's own rate.
    rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, allow_null=True)


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
    rent_daily = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    rent_weekly = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    rent_monthly = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    replacement_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
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
            "rent_daily": product.rent_daily,
            "rent_weekly": product.rent_weekly,
            "rent_monthly": product.rent_monthly,
            "replacement_cost": product.replacement_cost,
            "stock": stock,
            "on_hand": sum(stock.values()),
        }
