from django.db import migrations


def remove_purchasing(apps, schema_editor):
    """Purchasing is removed, so its module switch and manager permission go too."""
    Business = apps.get_model("accounts", "Business")
    for business in Business.objects.all():
        settings = dict(business.settings or {})
        modules = dict(settings.get("modules") or {})
        permissions = dict(settings.get("permissions") or {})
        modules.pop("purchases", None)
        permissions.pop("managerPurchases", None)
        settings["modules"] = modules
        settings["permissions"] = permissions
        business.settings = settings
        business.save(update_fields=["settings"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_rental_only_settings"),
    ]

    operations = [
        migrations.RunPython(remove_purchasing, migrations.RunPython.noop),
    ]
