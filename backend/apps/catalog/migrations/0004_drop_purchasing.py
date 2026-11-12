from django.db import migrations

# Children first, so no table is dropped while another still points at it.
TABLES = [
    "purchasing_paymentallocation",
    "purchasing_supplierpayment",
    "purchasing_supplierreturn",
    "purchasing_purchaseitem",
    "purchasing_purchase",
    "purchasing_supplier",
]


def drop_purchasing(apps, schema_editor):
    """The purchasing app is gone; take its tables and bookkeeping with it.

    The app can't drop its own tables, because its migrations left with it. Left behind,
    they would still hold foreign keys to products, branches and users, and deleting any of
    those would fail on a table nothing in the code knows about.

    Stock movements recorded by a purchase stay: they are the product's own history.
    """
    connection = schema_editor.connection
    existing = set(connection.introspection.table_names())
    cascade = " CASCADE" if connection.vendor == "postgresql" else ""
    for table in TABLES:
        if table in existing:
            schema_editor.execute(f"DROP TABLE {schema_editor.quote_name(table)}{cascade}")

    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM django_migrations WHERE app = %s", ["purchasing"])

    # Deleting the content types takes their permissions with them.
    apps.get_model("contenttypes", "ContentType").objects.filter(app_label="purchasing").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0003_rental_only_products"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        # One way: the tables' contents are not kept anywhere to bring back.
        migrations.RunPython(drop_purchasing, migrations.RunPython.noop),
    ]
