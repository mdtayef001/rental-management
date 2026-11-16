"""Stock becomes one number per product.

A business has one shop, so the per-branch StockLevel rows collapse into `Product.quantity`.
Each product's rows are summed, so nothing on any shelf is lost; on a business that did have
two branches the two counts become one.
"""

from django.db import migrations, models
from django.db.models import Sum


def copy_stock_onto_products(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    StockLevel = apps.get_model("catalog", "StockLevel")
    totals = StockLevel.objects.values("product_id").annotate(n=Sum("quantity"))
    for row in totals:
        Product.objects.filter(pk=row["product_id"]).update(quantity=row["n"] or 0)


def copy_stock_back(apps, schema_editor):
    """Undo: each product's count goes back onto its business's first branch."""
    Product = apps.get_model("catalog", "Product")
    StockLevel = apps.get_model("catalog", "StockLevel")
    Branch = apps.get_model("accounts", "Branch")
    first = {}
    for product in Product.objects.filter(quantity__gt=0):
        if product.business_id not in first:
            first[product.business_id] = (
                Branch.objects.filter(business_id=product.business_id).order_by("id").first()
                or Branch.objects.create(business_id=product.business_id, name="Main branch")
            )
        StockLevel.objects.create(
            business_id=product.business_id, product=product, branch=first[product.business_id],
            quantity=product.quantity,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_tidy_schema"),
        ("catalog", "0005_tidy_schema"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="quantity",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(copy_stock_onto_products, copy_stock_back),
        migrations.RemoveIndex(
            model_name="stocklevel",
            name="catalog_sto_busines_bea8ca_idx",
        ),
        migrations.RemoveConstraint(
            model_name="stocklevel",
            name="unique_stock_row",
        ),
        migrations.RemoveField(
            model_name="stockmovement",
            name="branch",
        ),
        migrations.DeleteModel(
            name="StockLevel",
        ),
    ]
