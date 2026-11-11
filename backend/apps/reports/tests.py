"""Tests for the reports.

Three things matter here. The figures have to be right, because an owner makes decisions on
them. They have to be the caller's *own* figures, because a report is the richest thing in
the system to leak. And they have to reach only the people the owner allowed, because they
are the money.
"""

import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import StockMovement
from apps.catalog.services import adjust_stock, create_customer, create_product
from apps.rentals import services as rentals
from apps.reports import services

PASSWORD = "correct-horse-battery"


def days_ago(n):
    """A timestamp just under `n` days old, so the day-counting rounds to n and not n+1."""
    return timezone.now() - timedelta(days=n) + timedelta(minutes=1)


class ReportsTestCase(APITestCase):
    """A shop with one week of real trading behind it.

    Mr. X rented 100 machines five days ago and brought 60 back today; Mr. Y rented 10
    tables three days ago and still has them. So there is revenue to total, a partial
    return to get right, and something still outstanding.
    """

    def setUp(self):
        cache.clear()
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Machine Rentals",
            owner_name="Owner",
            owner_email="owner@example.com",
            owner_password=PASSWORD,
        )
        self.machine = create_product(
            user=self.owner, sku="SM-100", barcode="8801234567890", name="Sewing machine",
            rentable=True, rent_daily=Decimal("50.00"), replacement_cost=Decimal("8000.00"),
        )
        self.table = create_product(
            user=self.owner, sku="TBL-1", name="Work table", rentable=True, rent_daily=Decimal("20.00"),
        )
        for product, quantity in ((self.machine, 1000), (self.table, 50)):
            adjust_stock(
                user=self.owner, product=product, branch=self.branch, quantity=quantity,
                reason=StockMovement.Reason.ADJUSTMENT,
            )
        self.mr_x = create_customer(user=self.owner, name="Mr. X", phone="01700000001")
        self.mr_y = create_customer(user=self.owner, name="Mr. Y", phone="01700000002")

        self.x_rental = rentals.create_rental(
            user=self.owner, customer=self.mr_x, branch=self.branch,
            lines=[{"product": self.machine, "quantity": 100, "plan": "daily"}],
            started_at=days_ago(5),
        )
        self.x_return = rentals.take_return(
            user=self.owner, rental=self.x_rental, lines=[{"item": self.x_rental.items.get(), "quantity": 60}],
        )
        self.y_rental = rentals.create_rental(
            user=self.owner, customer=self.mr_y, branch=self.branch,
            lines=[{"product": self.table, "quantity": 10, "plan": "daily"}],
            started_at=days_ago(3),
        )

    def login(self, user):
        res = self.client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return user

    def this_month(self):
        return services.parse_range({})


class RangeTests(APITestCase):
    def test_a_range_covers_whole_local_days(self):
        rng = services.parse_range({"from": "2026-10-01", "to": "2026-10-31"})
        self.assertEqual(rng.start.date().isoformat(), "2026-10-01")
        self.assertEqual(rng.last_day.isoformat(), "2026-10-31")
        # Half-open: the 31st is included in full, the 1st of November is not.
        self.assertEqual(rng.end.date().isoformat(), "2026-11-01")
        self.assertEqual(rng.days, 31)

    def test_a_backwards_range_is_swapped_rather_than_refused(self):
        rng = services.parse_range({"from": "2026-10-31", "to": "2026-10-01"})
        self.assertEqual(rng.start.date().isoformat(), "2026-10-01")
        self.assertEqual(rng.last_day.isoformat(), "2026-10-31")

    def test_nonsense_dates_fall_back_to_the_default_range(self):
        """A stale bookmark shows the last 30 days, not a 500."""
        rng = services.parse_range({"from": "yesterday", "to": "¯\\_(ツ)_/¯"})
        self.assertEqual(rng.last_day, timezone.localdate())
        self.assertEqual(rng.days, 30)

    def test_the_grouping_suits_the_length_of_the_range(self):
        self.assertEqual(services.auto_group(services.parse_range({}, default_days=14)), "day")
        self.assertEqual(services.auto_group(services.parse_range({}, default_days=90)), "week")
        self.assertEqual(services.auto_group(services.parse_range({}, default_days=365)), "month")


class SummaryTests(ReportsTestCase):
    def test_revenue_is_what_the_returns_charged(self):
        """60 machines, 5 days, 50 a day — and nothing for the 40 still out."""
        summary = services.summary(self.business, self.this_month())
        self.assertEqual(summary["rent"], Decimal("15000.00"))
        self.assertEqual(summary["revenue"], Decimal("15000.00"))
        self.assertEqual(summary["returns"], 1)

    def test_units_sent_out_and_units_back_are_counted_separately(self):
        summary = services.summary(self.business, self.this_month())
        self.assertEqual(summary["rentals"], 2)
        self.assertEqual(summary["unitsRented"], 110)
        self.assertEqual(summary["unitsReturned"], 60)
        # 40 machines plus 10 tables are still with customers.
        self.assertEqual(summary["unitsOut"], 50)
        self.assertEqual(summary["openRentals"], 2)

    def test_rent_earned_outside_the_range_is_not_counted(self):
        """A report for last month must not include this month's takings."""
        last_month = services.parse_range({"from": "2020-01-01", "to": "2020-01-31"})
        summary = services.summary(self.business, last_month)
        self.assertEqual(summary["revenue"], Decimal("0.00"))
        self.assertEqual(summary["rentals"], 0)
        # What is standing right now is not a dated figure, so it still shows.
        self.assertEqual(summary["openRentals"], 2)

    def test_what_customers_owe_is_the_whole_unpaid_balance(self):
        summary = services.summary(self.business, self.this_month())
        self.assertEqual(summary["outstanding"], Decimal("15000.00"))
        rentals.add_payment(user=self.owner, rental=self.x_rental, amount=Decimal("5000.00"))
        self.assertEqual(services.summary(self.business, self.this_month())["outstanding"], Decimal("10000.00"))

    def test_a_lost_item_shows_up_as_lost_and_charges_its_replacement(self):
        rentals.take_return(
            user=self.owner, rental=self.x_rental,
            lines=[{"item": self.x_rental.items.get(), "quantity": 2, "condition": "lost"}],
        )
        summary = services.summary(self.business, self.this_month())
        self.assertEqual(summary["unitsLost"], 2)
        self.assertEqual(summary["damageFees"], Decimal("16000.00"))


class GroupedReportTests(ReportsTestCase):
    def test_revenue_is_grouped_by_the_day_it_was_charged(self):
        group, rows = services.revenue_series(self.business, self.this_month(), "day")
        self.assertEqual(group, "day")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["period"], timezone.localdate().isoformat())
        self.assertEqual(rows[0]["revenue"], Decimal("15000.00"))

    def test_products_rank_by_what_they_earned(self):
        rows = services.top_products(self.business, self.this_month())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Sewing machine")
        self.assertEqual(rows[0]["sku"], "SM-100")
        self.assertEqual(rows[0]["units"], 60)
        self.assertEqual(rows[0]["revenue"], Decimal("15000.00"))

    def test_a_renamed_product_stays_one_row(self):
        """Names are frozen onto each rental line, so grouping by the text would split it."""
        self.machine.name = "Industrial sewing machine"
        self.machine.save(update_fields=["name"])
        second = rentals.create_rental(
            user=self.owner, customer=self.mr_y, branch=self.branch,
            lines=[{"product": self.machine, "quantity": 5, "plan": "daily"}],
            started_at=days_ago(2),
        )
        rentals.take_return(user=self.owner, rental=second, lines=[{"item": second.items.get(), "quantity": 5}])

        rows = services.top_products(self.business, self.this_month())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["units"], 65)

    def test_customers_rank_by_spend_and_carry_their_balance(self):
        rows = services.top_customers(self.business, self.this_month())
        self.assertEqual([row["name"] for row in rows], ["Mr. X"])
        self.assertEqual(rows[0]["phone"], "01700000001")
        self.assertEqual(rows[0]["revenue"], Decimal("15000.00"))
        self.assertEqual(rows[0]["outstanding"], Decimal("15000.00"))


class ApiTests(ReportsTestCase):
    def test_the_owner_sees_the_reports(self):
        self.login(self.owner)
        res = self.client.get("/api/reports/summary/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["revenue"], 15000.0)
        self.assertEqual(body["unitsOut"], 50)
        # camelCase on the wire, like every other endpoint.
        self.assertIn("lateFees", body)

    def test_staff_cannot_open_the_reports_at_all(self):
        helper = create_user(
            actor=self.owner, name="Helper", email="helper@example.com", password=PASSWORD, role=User.Role.STAFF,
        )
        self.login(helper)
        for path in ("summary", "revenue", "products", "customers", "export"):
            self.assertEqual(self.client.get(f"/api/reports/{path}/").status_code, 403, path)

    def test_a_manager_needs_the_owners_switch(self):
        manager = create_user(
            actor=self.owner, name="Manager", email="manager@example.com", password=PASSWORD, role=User.Role.MANAGER,
        )
        self.login(manager)
        self.assertEqual(self.client.get("/api/reports/summary/").status_code, 403)

        self.business.settings["permissions"]["managerProfit"] = True
        self.business.save(update_fields=["settings"])
        self.assertEqual(self.client.get("/api/reports/summary/").status_code, 200)

    def test_reports_need_a_login(self):
        for path in ("summary", "revenue", "products", "customers", "export"):
            self.assertEqual(self.client.get(f"/api/reports/{path}/").status_code, 401, path)

    def test_a_report_only_ever_shows_your_own_business(self):
        _, other_branch, other_owner = create_business(
            name="Chittagong Rentals", owner_name="Other", owner_email="other@example.com", owner_password=PASSWORD,
        )
        self.login(other_owner)
        body = self.client.get("/api/reports/summary/").json()
        self.assertEqual(body["revenue"], 0)
        self.assertEqual(body["openRentals"], 0)
        self.assertEqual(self.client.get("/api/reports/products/").json()["results"], [])

    def test_the_range_comes_from_the_query(self):
        self.login(self.owner)
        body = self.client.get("/api/reports/summary/?from=2020-01-01&to=2020-01-31").json()
        self.assertEqual(body["from"], "2020-01-01")
        self.assertEqual(body["to"], "2020-01-31")
        self.assertEqual(body["revenue"], 0)


class CsvTests(ReportsTestCase):
    def rows(self, query):
        res = self.client.get(f"/api/reports/export/?{query}")
        self.assertEqual(res.status_code, 200, query)
        self.assertTrue(res["Content-Type"].startswith("text/csv"))
        body = b"".join(res.streaming_content).decode()
        return res, list(csv.reader(io.StringIO(body)))

    def test_the_returns_export_has_a_line_per_returned_item(self):
        self.login(self.owner)
        res, rows = self.rows("report=returns")
        self.assertIn('attachment; filename="returns_', res["Content-Disposition"])
        # Row 0 names the business and the range, row 1 is the header, then the data.
        self.assertIn("Dhaka Machine Rentals", rows[0][0])
        self.assertEqual(rows[1][:3], ["Return", "Taken at", "Rental"])
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[2][0], "RT-000001")
        self.assertEqual(rows[2][6], "60")

    def test_the_rentals_export_lists_both_rentals_with_their_balances(self):
        self.login(self.owner)
        _, rows = self.rows("report=rentals")
        codes = [row[0] for row in rows[2:]]
        self.assertEqual(codes, ["RN-000001", "RN-000002"])
        balance = rows[1].index("Balance")
        self.assertEqual(rows[2][balance], "15000.00")

    def test_every_report_exports(self):
        self.login(self.owner)
        for report in ("revenue", "products", "customers", "rentals", "returns", "payments"):
            _, rows = self.rows(f"report={report}")
            self.assertGreaterEqual(len(rows), 2, report)

    def test_an_unknown_report_is_a_clear_400(self):
        self.login(self.owner)
        res = self.client.get("/api/reports/export/?report=everything")
        self.assertEqual(res.status_code, 400)
        self.assertIn("rentals", res.json()["reports"])

    def test_a_name_that_looks_like_a_formula_is_exported_as_text(self):
        """A customer called `=HYPERLINK(...)` must not run when the owner opens the file."""
        attacker = create_customer(user=self.owner, name='=HYPERLINK("http://evil.example","Click")')
        rental = rentals.create_rental(
            user=self.owner, customer=attacker, branch=self.branch,
            lines=[{"product": self.table, "quantity": 1, "plan": "daily"}],
            started_at=days_ago(1),
        )
        rentals.take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 1}])

        self.login(self.owner)
        _, rows = self.rows("report=customers")
        names = [row[0] for row in rows[2:]]
        self.assertTrue(any(name.startswith("'=HYPERLINK") for name in names), names)
        self.assertFalse(any(name.startswith("=") for name in names), names)

    def test_the_export_is_never_cached(self):
        self.login(self.owner)
        res, _ = self.rows("report=revenue")
        self.assertEqual(res["Cache-Control"], "no-store")


class PrintedReportTests(ReportsTestCase):
    """The report as a sheet: who owes, and the PDF the owner prints or sends."""

    def test_who_owes_lists_customers_with_an_unpaid_balance(self):
        rows = services.debtors(self.business)
        # Mr. X was charged for the 60 machines that came back and has paid nothing.
        self.assertEqual([row["name"] for row in rows], ["Mr. X"])
        self.assertEqual(rows[0]["owed"], self.x_return.charges)

    def test_money_paid_in_advance_is_not_a_debt(self):
        """Mr. Y pays ahead: he owes nothing, and his advance doesn't hide what Mr. X owes."""
        rentals.add_payment(user=self.owner, rental=self.y_rental, amount=Decimal("500.00"), kind="advance")
        summary = services.summary(self.business, self.this_month())
        self.assertEqual(summary["advancesHeld"], Decimal("500.00"))
        self.assertEqual(summary["outstanding"], self.x_return.charges)
        self.assertEqual([row["name"] for row in services.debtors(self.business)], ["Mr. X"])

    def test_the_report_downloads_as_a_pdf(self):
        self.login(self.owner)
        res = self.client.get("/api/reports/pdf/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/pdf")
        self.assertTrue(res.content.startswith(b"%PDF"))
        self.assertIn("attachment", res["Content-Disposition"])

    def test_the_pdf_carries_the_logo_when_there_is_one(self):
        self.login(self.owner)
        plain = self.client.get("/api/reports/pdf/").content
        pixel = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
        self.assertEqual(self.client.put("/api/business/logo/", {"image": pixel}, format="json").status_code, 200)
        with_logo = self.client.get("/api/reports/pdf/").content
        self.assertTrue(with_logo.startswith(b"%PDF"))
        self.assertIn(b"/Subtype /Image", with_logo)
        self.assertNotIn(b"/Subtype /Image", plain)

    def test_the_pdf_is_as_private_as_the_rest_of_the_reports(self):
        manager = create_user(
            actor=self.owner, name="Manager", email="manager@example.com", password=PASSWORD, role=User.Role.MANAGER
        )
        self.login(manager)
        self.assertEqual(self.client.get("/api/reports/pdf/").status_code, 403)
        self.assertEqual(self.client.get("/api/reports/debtors/").status_code, 403)
