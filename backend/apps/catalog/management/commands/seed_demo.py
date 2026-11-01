"""Creates a demo business to click through: `manage.py seed_demo`.

Deliberately models the client's own case — a thousand sewing machines, a hundred out with
Mr. X — including the awkward situations the return screen has to handle: the same product
out with two customers, the same customer renting the same product twice, a partly returned
rental, and one that is overdue.
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Business, User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import StockMovement
from apps.catalog.services import adjust_stock, create_customer, create_product
from apps.rentals.services import create_rental, take_return

PASSWORD = "rental-demo-2026"


class Command(BaseCommand):
    help = "Create a demo business with products, customers and rentals."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete the demo business first.")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            Business.objects.filter(name="Dhaka Machine Rentals").delete()
            User.objects.filter(email="admin@example.com").delete()
            self.stdout.write("Removed any previous demo data.")

        if Business.objects.filter(name="Dhaka Machine Rentals").exists():
            self.stdout.write(self.style.WARNING("Demo business already exists. Use --reset to rebuild it."))
            return

        # The platform super admin, who creates businesses.
        if not User.objects.filter(email="admin@example.com").exists():
            User.objects.create_superuser(email="admin@example.com", password=PASSWORD, name="Platform admin")

        business, branch, owner = create_business(
            name="Dhaka Machine Rentals",
            industry="Equipment rental",
            phone="+8801711000000",
            address="12 Motijheel C/A, Dhaka",
            branch_name="Motijheel shop",
            owner_name="Rahim Uddin",
            owner_email="owner@example.com",
            owner_password=PASSWORD,
        )

        manager = create_user(
            actor=owner, name="Karim Hossain", email="manager@example.com",
            password=PASSWORD, role=User.Role.MANAGER,
        )
        staff = create_user(
            actor=owner, name="Nadia Islam", email="staff@example.com",
            password=PASSWORD, role=User.Role.STAFF,
            rights={"can_rent": True, "can_take_returns": True, "can_handle_deposits": True},
        )
        staff.branches.set([branch])

        products = {}
        for sku, barcode, name, daily, weekly, deposit, replacement, quantity in [
            ("SM-100", "8801234567890", "Industrial sewing machine", "50.00", "300.00", "500.00", "8000.00", 1000),
            ("OL-200", "8801234567891", "Overlock machine", "80.00", "480.00", "800.00", "14000.00", 120),
            ("TBL-10", "8801234567892", "Work table", "20.00", "120.00", "0.00", "2500.00", 300),
            ("GEN-5", "8801234567893", "5kVA generator", "900.00", "5400.00", "5000.00", "95000.00", 8),
            ("IRN-1", "8801234567894", "Steam iron", "30.00", "180.00", "200.00", "3500.00", 60),
        ]:
            product = create_product(
                user=owner, sku=sku, barcode=barcode, name=name, category="Machinery",
                rentable=True, rent_daily=Decimal(daily), rent_weekly=Decimal(weekly),
                deposit=Decimal(deposit), replacement_cost=Decimal(replacement),
                low_stock_threshold=max(2, quantity // 20),
            )
            adjust_stock(
                user=owner, product=product, branch=branch, quantity=quantity,
                reason=StockMovement.Reason.ADJUSTMENT, note="Opening count",
            )
            products[sku] = product

        customers = {
            name: create_customer(
                user=owner, name=name, phone=phone, company=company,
                id_type="NID", id_number=nid,
            )
            for name, phone, company, nid in [
                ("Mr. X Garments", "01711111111", "X Garments Ltd", "1990123456789"),
                ("Mr. Y Textiles", "01722222222", "Y Textiles", "1985987654321"),
                ("Fatima Tailors", "01733333333", "", "1992456789123"),
                ("Dhaka Events", "01744444444", "Dhaka Events Ltd", ""),
            ]
        }

        now = timezone.now()

        # The client's own example: 100 of the 1,000 machines out with Mr. X.
        big = create_rental(
            user=owner, customer=customers["Mr. X Garments"], branch=branch,
            started_at=now - timedelta(days=12), due_at=now + timedelta(days=18),
            deposit=Decimal("50000.00"),
            lines=[
                {"product": products["SM-100"], "quantity": 100, "plan": "daily"},
                {"product": products["TBL-10"], "quantity": 20, "plan": "daily"},
            ],
            notes="Monthly contract for the Mirpur unit.",
        )

        # The same customer renting the same product again — so a scan has to ask which
        # rental is coming back.
        create_rental(
            user=staff, customer=customers["Mr. X Garments"], branch=branch,
            started_at=now - timedelta(days=2), due_at=now + timedelta(days=5),
            deposit=Decimal("10000.00"),
            lines=[{"product": products["SM-100"], "quantity": 20, "plan": "daily"}],
            notes="Extra machines for a rush order.",
        )

        # The same product out with a different customer, for the same reason.
        create_rental(
            user=staff, customer=customers["Mr. Y Textiles"], branch=branch,
            started_at=now - timedelta(days=5), due_at=now + timedelta(days=9),
            deposit=Decimal("25000.00"),
            lines=[{"product": products["SM-100"], "quantity": 50, "plan": "weekly"}],
        )

        # Overdue, so the dashboard and the late fee have something to show.
        create_rental(
            user=manager, customer=customers["Fatima Tailors"], branch=branch,
            started_at=now - timedelta(days=20), due_at=now - timedelta(days=6),
            deposit=Decimal("1000.00"),
            lines=[
                {"product": products["IRN-1"], "quantity": 5, "plan": "daily"},
                {"product": products["OL-200"], "quantity": 2, "plan": "daily"},
            ],
            notes="Chased twice by phone.",
        )

        # Two more overdue, at different severities, so the chase list shows all three of
        # its levels: a nudge (1-3 days), a real problem (4-14), and stock at risk (15+).
        create_rental(
            user=staff, customer=customers["Dhaka Events"], branch=branch,
            started_at=now - timedelta(days=9), due_at=now - timedelta(days=2),
            deposit=Decimal("2000.00"),
            lines=[{"product": products["IRN-1"], "quantity": 3, "plan": "daily"}],
        )
        create_rental(
            user=owner, customer=customers["Mr. Y Textiles"], branch=branch,
            started_at=now - timedelta(days=40), due_at=now - timedelta(days=21),
            deposit=Decimal("8000.00"),
            lines=[{"product": products["OL-200"], "quantity": 4, "plan": "weekly"}],
            notes="No answer on the phone for two weeks.",
        )

        # Open-ended, no agreed return date.
        create_rental(
            user=owner, customer=customers["Dhaka Events"], branch=branch,
            started_at=now - timedelta(days=3), due_at=None,
            deposit=Decimal("10000.00"),
            lines=[{"product": products["GEN-5"], "quantity": 2, "plan": "daily"}],
        )

        # A partial return: 40 of Mr. X's 100 machines come back, 60 keep running.
        machines = big.items.filter(product=products["SM-100"]).first()
        take_return(
            user=owner, rental=big,
            lines=[{"item": machines, "quantity": 40, "condition": "good"}],
            paid_amount=Decimal("20000.00"), payment_method="cash",
            note="First batch back after the Eid break.",
        )

        self.stdout.write(self.style.SUCCESS("\nDemo data ready.\n"))
        self.stdout.write(f"  Super admin   admin@example.com    {PASSWORD}")
        self.stdout.write(f"  Owner         owner@example.com    {PASSWORD}")
        self.stdout.write(f"  Manager       manager@example.com  {PASSWORD}")
        self.stdout.write(f"  Staff         staff@example.com    {PASSWORD}")
        self.stdout.write(
            "\nTry scanning 8801234567890 on Take back: it is out with three rentals,\n"
            "so the chooser has to ask which one is coming back.\n"
        )
