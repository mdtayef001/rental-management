from django.db import migrations


def tidy_settings(apps, schema_editor):
    """Deposits are gone, and purchasing is no longer something a business switches on.

    Nothing is deleted: suppliers and purchase bills already recorded stay in the database,
    the screens for them are simply no longer offered.
    """
    Business = apps.get_model("accounts", "Business")
    for business in Business.objects.all():
        settings = dict(business.settings or {})
        rentals = dict(settings.get("rentals") or {})
        rentals.pop("depositRequired", None)
        settings["rentals"] = rentals
        modules = dict(settings.get("modules") or {})
        modules["purchases"] = False
        settings["modules"] = modules
        business.settings = settings
        business.save(update_fields=["settings"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_business_logo"),
    ]

    operations = [
        migrations.RunPython(tidy_settings, migrations.RunPython.noop),
    ]
