from django.db import migrations


class Migration(migrations.Migration):
    """Products are rented, not sold, and carry no deposit."""

    dependencies = [
        ("catalog", "0002_customer_rate"),
    ]

    operations = [
        migrations.RemoveField(model_name="product", name="deposit"),
        migrations.RemoveField(model_name="product", name="sellable"),
        migrations.RemoveField(model_name="product", name="price"),
    ]
