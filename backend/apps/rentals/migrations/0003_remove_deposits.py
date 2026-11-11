from django.db import migrations


class Migration(migrations.Migration):
    """Drops the deposit columns, after 0002 has moved the money they held."""

    dependencies = [
        ("rentals", "0002_deposits_become_advances"),
        ("catalog", "0003_rental_only_products"),
    ]

    operations = [
        migrations.RemoveField(model_name="rental", name="deposit"),
        migrations.RemoveField(model_name="rental", name="deposit_refunded"),
        migrations.RemoveField(model_name="rentalitem", name="deposit"),
        migrations.RenameField(model_name="rentalreturn", old_name="deposit_refunded", new_name="refunded"),
    ]
