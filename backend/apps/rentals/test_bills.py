"""Tests for bills: what a customer is charged for a month or a year.

The property that matters most is that bills *add up*. A company billed every month for
machines it keeps for a year must end up charged exactly what the rental cost — no day
billed twice across two months, and none falling through the gap between them.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
from apps.rentals import services, statements
from apps.rentals.models import RentalPayment
from apps.reports.services import Range, day_start

from .tests import RentalTestCase

PASSWORD = "correct-horse-battery"


def local(year, month, day, hour=10):
    return timezone.make_aware(datetime(year, month, day, hour))


def month(year, number):
    first = date(year, number, 1)
    last = statements.month_end(first)
    return Range(start=day_start(first), end=day_start(last + timedelta(days=1)), last_day=last)


def year(number):
    return Range(start=day_start(date(number, 1, 1)), end=day_start(date(number + 1, 1, 1)), last_day=date(number, 12, 31))


class BillTestCase(RentalTestCase):
    """Mr. X takes 100 machines at 50 a day on 10 January 2025 and brings 60 back on
    5 February. The other 40 are still with him."""

    def setUp(self):
        super().setUp()
        self.rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}], started_at=local(2025, 1, 10)
        )
        self.item = self.rental.items.get()
        services.take_return(
            user=self.owner, rental=self.rental, at=local(2025, 2, 5), lines=[{"item": self.item, "quantity": 60}]
        )

    def bill(self, rng, customer=None):
        return statements.build_statement(self.business, customer or self.mr_x, rng)

    def pay(self, amount, at, rental=None):
        payment = services.add_payment(user=self.owner, rental=rental or self.rental, amount=Decimal(amount))
        RentalPayment.objects.filter(pk=payment.pk).update(at=at)
        return payment


class MonthlyBillTests(BillTestCase):
    def test_the_first_month_charges_from_the_day_the_machines_were_taken(self):
        bill = self.bill(month(2025, 1))
        # 10 Jan 10:00 to the end of the month is 22 started days: 22 × 50 × 100.
        self.assertEqual(bill["totals"]["rent"], Decimal("110000.00"))
        self.assertEqual(bill["totals"]["opening_balance"], Decimal("0.00"))
        self.assertEqual(bill["totals"]["closing_balance"], Decimal("110000.00"))
        self.assertEqual(bill["kind"], "month")
        self.assertEqual(bill["label"], "January 2025")

        line = bill["rentals"][0]["lines"][0]
        self.assertEqual(line["taken"], 100)
        self.assertEqual(line["out_at_start"], 0)
        self.assertEqual(line["out_at_end"], 100)
        self.assertEqual(bill["rentals"][0]["started_at"], local(2025, 1, 10))

    def test_the_next_month_charges_only_what_ran_up_in_it(self):
        bill = self.bill(month(2025, 2))
        # 60 came back after 26 days (78,000), 66,000 of which January already billed.
        # The 40 still out ran from day 22 to day 50: 28 × 50 × 40 = 56,000.
        self.assertEqual(bill["totals"]["rent"], Decimal("68000.00"))
        self.assertEqual(bill["totals"]["opening_balance"], Decimal("110000.00"))

        line = bill["rentals"][0]["lines"][0]
        self.assertEqual(line["out_at_start"], 100)
        self.assertEqual(line["taken"], 0)
        self.assertEqual(line["returned"], 60)
        self.assertEqual(line["out_at_end"], 40)
        self.assertEqual(line["returns"][0]["at"], local(2025, 2, 5))

    def test_a_payment_comes_off_the_month_it_was_made_in(self):
        self.pay("100000", local(2025, 2, 10))
        january, february = self.bill(month(2025, 1)), self.bill(month(2025, 2))
        self.assertEqual(january["totals"]["paid"], Decimal("0.00"))
        self.assertEqual(february["totals"]["paid"], Decimal("100000.00"))
        self.assertEqual(february["totals"]["closing_balance"], Decimal("78000.00"))
        # …and is carried into March as part of what was already settled.
        self.assertEqual(self.bill(month(2025, 3))["totals"]["opening_balance"], Decimal("78000.00"))

    def test_twelve_monthly_bills_add_up_to_the_yearly_one(self):
        months = [self.bill(month(2025, n))["totals"]["charges"] for n in range(1, 13)]
        whole = self.bill(year(2025))
        self.assertEqual(sum(months), whole["totals"]["charges"])
        # 60 machines for 26 days, and 40 for the 356 started days left in the year.
        self.assertEqual(whole["totals"]["charges"], Decimal("78000.00") + 356 * 50 * 40)
        self.assertEqual(whole["kind"], "year")
        self.assertEqual(whole["label"], "2025")

    def test_bills_up_to_today_add_up_to_what_the_rental_has_cost_so_far(self):
        today = timezone.localdate()
        everything = Range(start=day_start(date(2025, 1, 1)), end=day_start(today + timedelta(days=1)), last_day=today)
        bill = self.bill(everything)
        self.rental.refresh_from_db()
        still_running = self.item.__class__.objects.get(pk=self.item.pk).quote_now()
        self.assertEqual(bill["totals"]["charges"], self.rental.charges + still_running)
        self.assertIsNotNone(bill["as_of"])

    def test_late_fees_and_discounts_land_in_the_month_of_the_return(self):
        services.take_return(
            user=self.owner, rental=self.rental, at=local(2025, 3, 3), discount=Decimal("500.00"),
            lines=[{"item": self.item, "quantity": 10, "condition": "lost"}],
        )
        march = self.bill(month(2025, 3))
        self.assertEqual(march["totals"]["discount"], Decimal("500.00"))
        self.assertEqual(march["totals"]["damage_fee"], Decimal("80000.00"))
        self.assertEqual(self.bill(month(2025, 2))["totals"]["damage_fee"], Decimal("0.00"))

    def test_a_month_before_anything_was_taken_is_empty(self):
        bill = self.bill(month(2024, 12))
        self.assertEqual(bill["rentals"], [])
        self.assertEqual(bill["totals"]["closing_balance"], Decimal("0.00"))

    def test_a_rental_finished_before_the_period_is_only_a_balance_brought_forward(self):
        services.take_return(
            user=self.owner, rental=self.rental, at=local(2025, 2, 20), lines=[{"item": self.item, "quantity": 40}]
        )
        april = self.bill(month(2025, 4))
        self.rental.refresh_from_db()
        self.assertEqual(april["rentals"], [])
        self.assertEqual(april["totals"]["opening_balance"], self.rental.charges)

    def test_another_customers_rentals_never_appear(self):
        self.rent(self.mr_y, [{"product": self.table, "quantity": 5, "plan": "daily"}], started_at=local(2025, 1, 15))
        bill = self.bill(month(2025, 1))
        self.assertEqual([r["code"] for r in bill["rentals"]], [self.rental.code])

    def test_a_cancelled_rental_is_not_billed(self):
        mistake = self.rent(self.mr_x, [{"product": self.table, "quantity": 5, "plan": "daily"}], started_at=local(2025, 1, 15))
        services.cancel_rental(user=self.owner, rental=mistake)
        self.assertEqual(len(self.bill(month(2025, 1))["rentals"]), 1)

    def test_the_bill_number_is_the_same_every_time(self):
        self.assertEqual(self.bill(month(2025, 1))["number"], f"BILL-{self.mr_x.id:04d}-202501")
        self.assertEqual(self.bill(year(2025))["number"], f"BILL-{self.mr_x.id:04d}-2025")


class PeriodTests(BillTestCase):
    def test_no_dates_means_this_month_so_far(self):
        rng = statements.parse_period({})
        self.assertEqual(rng.start.date(), timezone.localdate().replace(day=1))
        self.assertEqual(rng.last_day, timezone.localdate())

    def test_everyones_bills_for_a_month(self):
        self.rent(self.mr_y, [{"product": self.table, "quantity": 5, "plan": "daily"}], started_at=local(2025, 1, 31))
        rows = statements.period_bills(self.business, month(2025, 1))
        self.assertEqual([r["customer_name"] for r in rows], ["Mr. X", "Mr. Y"])
        self.assertEqual(rows[0]["charges"], Decimal("110000.00"))
        self.assertEqual(rows[1]["charges"], Decimal("100.00"))
        self.assertEqual(rows[0]["units_out"], 100)
        self.assertEqual([r["customer_name"] for r in statements.period_bills(self.business, month(2025, 1), "y")], ["Mr. Y"])


class ReceivePaymentTests(BillTestCase):
    def test_one_payment_settles_the_oldest_rental_first(self):
        services.take_return(
            user=self.owner, rental=self.rental, at=local(2025, 2, 20), lines=[{"item": self.item, "quantity": 40}]
        )
        self.rental.refresh_from_db()
        first_owes = self.rental.balance
        second = self.rent(self.mr_x, [{"product": self.table, "quantity": 1, "plan": "fixed", "rate": Decimal("900.00")}])

        paid = statements.receive_payment(user=self.owner, customer=self.mr_x, amount=first_owes + 400)
        self.rental.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.rental.balance, Decimal("0.00"))
        self.assertEqual(second.paid_amount, Decimal("400.00"))
        self.assertEqual([p["rental_code"] for p in paid], [self.rental.code, second.code])

    def test_paying_too_much_leaves_credit_on_the_open_rental(self):
        owing = statements.run_up_total(statements.billable(self.business).get(pk=self.rental.pk), timezone.now())
        statements.receive_payment(user=self.owner, customer=self.mr_x, amount=owing + 1000)
        self.rental.refresh_from_db()
        self.assertEqual(self.rental.paid_amount, owing + 1000)


class BillApiTests(BillTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.login(self.owner)

    def login(self, user):
        res = self.client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_the_bill_for_a_month(self):
        res = self.client.get(f"/api/bills/{self.mr_x.id}/", {"from": "2025-01-01", "to": "2025-01-31"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["kind"], "month")
        self.assertEqual(Decimal(str(body["totals"]["closingBalance"])), Decimal("110000.00"))
        self.assertEqual(body["rentals"][0]["lines"][0]["outAtEnd"], 100)

    def test_the_list_of_bills(self):
        res = self.client.get("/api/bills/", {"from": "2025-01-01", "to": "2025-01-31", "page": 1})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["customerName"], "Mr. X")
        self.assertEqual(Decimal(str(body["totals"]["charges"])), Decimal("110000.00"))

    def test_the_pdf_is_a_file_named_after_the_bill(self):
        res = self.client.get(f"/api/bills/{self.mr_x.id}/pdf/", {"from": "2025-01-01", "to": "2025-12-31"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/pdf")
        self.assertIn(f"BILL-{self.mr_x.id:04d}-2025-Mr--X.pdf", res["Content-Disposition"])
        self.assertTrue(res.content.startswith(b"%PDF"))

    def test_paying_a_bill_through_the_api(self):
        res = self.client.post(f"/api/bills/{self.mr_x.id}/payment/", {"amount": "5000.00", "method": "bank"}, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        self.rental.refresh_from_db()
        self.assertEqual(self.rental.paid_amount, Decimal("5000.00"))

    def test_staff_cannot_open_bills(self):
        helper = create_user(actor=self.owner, name="Helper", email="helper@example.com", password=PASSWORD, role=User.Role.STAFF)
        self.login(helper)
        self.assertEqual(self.client.get(f"/api/bills/{self.mr_x.id}/").status_code, 403)
        self.assertEqual(self.client.get("/api/bills/").status_code, 403)

    def test_another_businesss_customer_is_not_found(self):
        _, _, their_owner = create_business(
            name="Sylhet Tools", owner_name="Them", owner_email="them@example.com", owner_password=PASSWORD
        )
        self.login(their_owner)
        self.assertEqual(self.client.get(f"/api/bills/{self.mr_x.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/bills/{self.mr_x.id}/pdf/").status_code, 404)
        self.assertEqual(self.client.get("/api/bills/", {"from": "2025-01-01", "to": "2025-01-31"}).json()["count"], 0)


class BillDaysTests(BillTestCase):
    """The rows a customer checks against their own register: out, back, days, days off."""

    def test_each_return_is_its_own_row_with_its_days(self):
        line = self.bill(year(2025))["rentals"][0]["lines"][0]
        back, out = line["stretches"]
        # 60 came back on 5 February: 10 January to 5 February is 26 days.
        self.assertEqual((back["quantity"], back["days"], back["days_off"]), (60, 26, 0))
        self.assertEqual(back["back_at"], local(2025, 2, 5))
        self.assertEqual(back["rent"], Decimal("78000.00"))
        # The other 40 were never returned, so they are out for the rest of the year.
        self.assertEqual(out["quantity"], 40)
        self.assertIsNone(out["back_at"])
        self.assertEqual(out["out_at"], local(2025, 1, 10))

    def test_the_rows_add_up_to_the_line(self):
        for rng in (month(2025, 1), month(2025, 2), month(2025, 3), year(2025)):
            for line in self.bill(rng)["rentals"][0]["lines"]:
                self.assertEqual(sum(s["rent"] for s in line["stretches"]), line["rent"])

    def test_a_month_only_counts_its_own_days(self):
        january = self.bill(month(2025, 1))["rentals"][0]["lines"][0]["stretches"]
        # Nothing came back in January, so all 100 read as one row: 10–31 January, 22 days.
        self.assertEqual([(s["quantity"], s["days"]) for s in january], [(100, 22)])
        february = self.bill(month(2025, 2))["rentals"][0]["lines"][0]["stretches"]
        self.assertEqual([(s["quantity"], s["days"]) for s in february], [(60, 4), (40, 28)])

    def test_days_off_are_shown_and_not_charged(self):
        services.take_return(
            user=self.owner, rental=self.rental, at=local(2025, 2, 20),
            lines=[{"item": self.item, "quantity": 40, "holidays": 3}],
        )
        bill = self.bill(year(2025))
        last = bill["rentals"][0]["lines"][0]["stretches"][-1]
        self.assertEqual((last["quantity"], last["days"], last["days_off"]), (40, 41, 3))
        self.assertEqual(last["rent"], Decimal("76000.00"))  # 38 charged days × 50 × 40
        self.assertEqual(bill["totals"]["days_off"], 3)

    def test_the_pdf_still_draws(self):
        from apps.rentals import bill_pdf

        self.assertTrue(bill_pdf.render(self.bill(year(2025))).startswith(b"%PDF"))
