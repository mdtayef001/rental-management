import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """A logo for receipts, bills and reports; and no more per-person deposit right."""

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="business",
            name="logo_version",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.CreateModel(
            name="BusinessLogo",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("content_type", models.CharField(max_length=20)),
                ("data", models.BinaryField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "business",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, related_name="logo", to="accounts.business"
                    ),
                ),
            ],
        ),
        migrations.RemoveField(model_name="user", name="can_handle_deposits"),
    ]
