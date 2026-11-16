"""The app is only rentals, so the per-business `modules` switch goes from settings."""

from django.db import migrations


def drop_modules(apps, schema_editor):
    Business = apps.get_model("accounts", "Business")
    for business in Business.objects.all():
        if "modules" in business.settings:
            del business.settings["modules"]
            business.save(update_fields=["settings"])


def restore_modules(apps, schema_editor):
    Business = apps.get_model("accounts", "Business")
    for business in Business.objects.all():
        business.settings.setdefault("modules", {"rentals": True})
        business.save(update_fields=["settings"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_remove_branches"),
    ]

    operations = [
        migrations.RunPython(drop_modules, restore_modules),
    ]
