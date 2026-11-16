"""Every rental has a customer, so the column stops allowing none.

Rentals have needed a named customer since November 2026, but rows from before then could
still be walk-ins. This migration refuses to run while any are left rather than inventing a
customer for them: give each one its real customer first (the message names them), then run
`migrate` again.
"""

import django.db.models.deletion
from django.db import migrations, models


def refuse_walk_ins(apps, schema_editor):
    Rental = apps.get_model("rentals", "Rental")
    left = list(
        Rental.objects.filter(customer__isnull=True)
        .order_by("business_id", "number")
        .values_list("business_id", "number")
    )
    if left:
        named = ", ".join(f"RN-{number:06d} (business {business})" for business, number in left[:20])
        more = f" and {len(left) - 20} more" if len(left) > 20 else ""
        raise RuntimeError(
            f"{len(left)} rental(s) have no customer: {named}{more}. "
            "Give each one a customer, then run migrate again."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0006_remove_branches"),
        ("rentals", "0005_remove_branches"),
    ]

    operations = [
        migrations.RunPython(refuse_walk_ins, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="rental",
            name="customer",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.RESTRICT, related_name="rentals", to="catalog.customer"
            ),
        ),
    ]
