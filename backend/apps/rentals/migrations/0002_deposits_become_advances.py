from django.db import migrations, models
from django.db.models import F


def deposits_to_advances(apps, schema_editor):
    """Turn every deposit still held into money paid in advance.

    A deposit was the customer's money, held beside the rental. With deposits gone it is
    still their money, so it moves onto the rental as credit: whatever was taken and not
    yet given back is added to what they have paid. The payment rows keep their amounts
    and dates and are only relabelled, so the till still reconciles to the same total.
    """
    Rental = apps.get_model("rentals", "Rental")
    RentalPayment = apps.get_model("rentals", "RentalPayment")

    Rental.objects.exclude(deposit=F("deposit_refunded")).update(
        paid_amount=F("paid_amount") + F("deposit") - F("deposit_refunded")
    )
    RentalPayment.objects.filter(kind="deposit").update(kind="advance")
    RentalPayment.objects.filter(kind="deposit_refund").update(kind="refund")


class Migration(migrations.Migration):

    dependencies = [
        ("rentals", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="rentalpayment",
            name="kind",
            field=models.CharField(
                choices=[("advance", "Paid in advance"), ("rent", "Payment"), ("refund", "Given back")],
                max_length=20,
            ),
        ),
        # One way only: once the columns are dropped there is nothing to say which part of
        # a payment had been a deposit.
        migrations.RunPython(deposits_to_advances, migrations.RunPython.noop),
    ]
