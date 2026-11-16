"""A business is one shop: the Branch table and the people-to-branch links go."""

from django.db import migrations


def drop_branch_permission(apps, schema_editor):
    Business = apps.get_model("accounts", "Business")
    for business in Business.objects.all():
        permissions = business.settings.get("permissions", {})
        if "managerBranches" in permissions:
            del permissions["managerBranches"]
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_tidy_schema"),
        ("catalog", "0006_remove_branches"),
        ("rentals", "0005_remove_branches"),
    ]

    operations = [
        migrations.RunPython(drop_branch_permission, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="user",
            name="branches",
        ),
        migrations.DeleteModel(
            name="Branch",
        ),
    ]
