"""Tests for the rental cycle.

These cover the things that would hurt most if they broke: stock and rentals drifting
apart, the scan-in flow picking the wrong customer's goods, money being charged twice, and
one business reaching another's data.
"""

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import StockLevel, StockMovement
from apps.catalog.services import adjust_stock, find_by_code
from apps.rentals import services
from apps.rentals.models import Rental, RentalItem, RentalPayment, RentalReturn, RentalReturnLine


def days_ago(n):
    """A start time just under `n` days ago.

    `count_days` rounds any started day up, so a timestamp exactly n days old is a hair
    over the boundary and bills n+1. Tests that mean "n days out" use this; the rounding
    rule itself is pinned down by `test_counting_days_counts_any_started_day`.
    """
    return timezone.now() - timedelta(days=n) + timedelta(minutes=1)


class RentalTestCase(TestCase):
    """A business with one branch, one owner, and 1,000 sewing machines on the shelf."""

    def setUp(self):
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals",
            owner_name="Owner",
            owner_email="owner@example.com",
            owner_password="correct-horse-battery",
        )
        from apps.catalog.services import create_customer, create_product

        self.machine = create_product(
            user=self.owner,
            sku="SM-100",
            barcode="8801234567890",
            name="Sewing machine",
            rentable=True,
            rent_daily=Decimal("50.00"),
            replacement_cost=Decimal("8000.00"),
        )
        self.table = create_product(
            user=self.owner,
            sku="TBL-1",
            barcode="8809999999999",
            name="Work table",
            rentable=True,
            rent_daily=Decimal("20.00"),
        )
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=1000,
            reason=StockMovement.Reason.ADJUSTMENT, note="Opening count",
        )
        adjust_stock(
            user=self.owner, product=self.table, branch=self.branch, quantity=50,
            reason=StockMovement.Reason.ADJUSTMENT, note="Opening count",
        )
        self.mr_x = create_customer(user=self.owner, name="Mr. X", phone="01700000001")
        self.mr_y = create_customer(user=self.owner, name="Mr. Y", phone="01700000002")

    def on_hand(self, product):
        return StockLevel.objects.get(product=product, branch=self.branch).quantity

    def rent(self, customer, lines, **kwargs):
        return services.create_rental(user=self.owner, customer=customer, branch=self.branch, lines=lines, **kwargs)


class RentOutTests(RentalTestCase):
    def test_renting_takes_stock_off_the_shelf(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        self.assertEqual(self.on_hand(self.machine), 900)
        self.assertEqual(rental.code, "RN-000001")
        self.assertEqual(rental.status, Rental.Status.ACTIVE)
        self.assertEqual(rental.items.get().quantity_out, 100)

    def test_a_rental_without_a_customer_is_refused_and_moves_nothing(self):
        with self.assertRaises(ValidationError):
            self.rent(None, [{"product": self.machine, "quantity": 5, "plan": "daily"}])
        self.assertEqual(self.on_hand(self.machine), 1000)
        self.assertEqual(Rental.objects.count(), 0)

    def test_the_summary_counts_what_came_back_today_even_from_a_part_return(self):
        from rest_framework.test import APIClient

        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        services.take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 60}])
        client = APIClient()
        client.force_authenticate(self.owner)
        data = client.get("/api/rentals/summary/").data
        # Still open, so no rental has "returned" — but 60 units did come back.
        self.assertEqual(data["returned_today"], 0)
        self.assertEqual(data["returnsToday"], 1)
        self.assertEqual(data["unitsReturnedToday"], 60)
        self.assertEqual(data["unitsOut"], 40)

    def test_a_removed_customer_keeps_their_rentals_and_leaves_the_list(self):
        from rest_framework.test import APIClient

        from apps.catalog.services import delete_customer

        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 5, "plan": "daily"}])
        # Still holding items: can't be removed at all.
        with self.assertRaises(ValidationError):
            delete_customer(user=self.owner, customer=self.mr_x)
        services.take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 5}])

        self.assertTrue(delete_customer(user=self.owner, customer=self.mr_x))
        rental.refresh_from_db()
        self.assertEqual(rental.customer.name, "Mr. X")

        client = APIClient()
        client.force_authenticate(self.owner)
        names = [row["name"] for row in client.get("/api/customers/").data]
        self.assertNotIn("Mr. X", names)
        self.assertIn("Mr. Y", names)
        # Still opens by id, so the links on old bills and receipts work.
        self.assertEqual(client.get(f"/api/customers/{self.mr_x.id}/").status_code, 200)
        # And can't be rented to.
        with self.assertRaises(ValidationError):
            self.rent(self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}])

    def test_a_customer_who_never_rented_is_deleted_outright(self):
        from apps.catalog.models import Customer
        from apps.catalog.services import delete_customer

        self.assertFalse(delete_customer(user=self.owner, customer=self.mr_y))
        self.assertFalse(Customer.objects.filter(name="Mr. Y").exists())

    def test_an_archived_products_code_can_be_used_by_its_replacement(self):
        from apps.catalog.services import create_product, delete_product

        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 5, "plan": "daily"}])
        services.take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 5}])
        sku = self.machine.sku
        self.assertTrue(delete_product(user=self.owner, product=self.machine))
        new = create_product(user=self.owner, name="New machine", sku=sku, rentable=True, rent_daily=Decimal("60.00"))
        self.assertEqual(new.sku, sku)
        # The old rental still points at the old product, by name and by row.
        item = rental.items.get()
        self.assertEqual(item.product_id, self.machine.id)
        self.assertEqual(item.product_name, self.machine.name)

    def test_one_rental_holds_several_products(self):
        rental = self.rent(
            self.mr_x,
            [
                {"product": self.machine, "quantity": 100, "plan": "daily"},
                {"product": self.table, "quantity": 10, "plan": "daily"},
            ],
        )
        self.assertEqual(rental.items.count(), 2)
        self.assertEqual(self.on_hand(self.machine), 900)
        self.assertEqual(self.on_hand(self.table), 40)

    def test_renting_more_than_is_on_the_shelf_is_refused_and_moves_nothing(self):
        with self.assertRaises(ValidationError):
            self.rent(
                self.mr_x,
                [
                    {"product": self.machine, "quantity": 100, "plan": "daily"},
                    # More tables than exist: the whole rental must roll back.
                    {"product": self.table, "quantity": 500, "plan": "daily"},
                ],
            )
        self.assertEqual(self.on_hand(self.machine), 1000)
        self.assertEqual(self.on_hand(self.table), 50)
        self.assertEqual(Rental.objects.count(), 0)

    def test_rental_numbers_are_gapless_per_business(self):
        for _ in range(3):
            self.rent(self.mr_x, [{"product": self.table, "quantity": 1, "plan": "daily"}])
        self.assertEqual([r.code for r in Rental.objects.order_by("number")], ["RN-000001", "RN-000002", "RN-000003"])

    def test_a_blocked_customer_cannot_rent(self):
        self.mr_x.blocked = True
        self.mr_x.blocked_reason = "Unpaid bill"
        self.mr_x.save()
        with self.assertRaises(ValidationError):
            self.rent(self.mr_x, [{"product": self.table, "quantity": 1, "plan": "daily"}])

    def test_the_same_product_twice_on_one_rental_is_refused(self):
        with self.assertRaises(ValidationError):
            self.rent(
                self.mr_x,
                [
                    {"product": self.table, "quantity": 1, "plan": "daily"},
                    {"product": self.table, "quantity": 2, "plan": "daily"},
                ],
            )


class ScanTests(RentalTestCase):
    """The scan-in flow the client asked for by name."""

    def test_scanning_a_barcode_finds_the_product(self):
        self.assertEqual(find_by_code(self.business, "8801234567890"), self.machine)
        self.assertEqual(find_by_code(self.business, "SM-100"), self.machine)
        self.assertEqual(find_by_code(self.business, "sku:SM-100"), self.machine)
        self.assertIsNone(find_by_code(self.business, "nothing-like-this"))

    def test_one_rental_of_a_product_resolves_without_asking(self):
        self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        result = services.resolve_return(self.business, code="8801234567890")
        self.assertEqual(result["matchedBy"], "product")
        self.assertEqual(len(result["matches"]), 1)
        # Only one candidate, so the screen goes straight to it.
        self.assertIsNotNone(result["exact"])
        self.assertEqual(result["matches"][0]["customerName"], "Mr. X")
        self.assertEqual(result["matches"][0]["quantityOut"], 100)

    def test_the_same_product_out_to_two_customers_asks_which_one(self):
        self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        self.rent(self.mr_y, [{"product": self.machine, "quantity": 50, "plan": "daily"}])
        result = services.resolve_return(self.business, code="8801234567890")
        self.assertEqual(len(result["matches"]), 2)
        # Two candidates: the screen must ask, and has what it needs to tell them apart.
        self.assertIsNone(result["exact"])
        names = {m["customerName"] for m in result["matches"]}
        self.assertEqual(names, {"Mr. X", "Mr. Y"})
        quantities = {m["customerName"]: m["quantityOut"] for m in result["matches"]}
        self.assertEqual(quantities, {"Mr. X": 100, "Mr. Y": 50})
        self.assertTrue(all(m["rentalCode"] for m in result["matches"]))

    def test_the_same_customer_renting_the_same_product_twice_asks_which_rental(self):
        """The client's exact case: Mr. X rented 100 machines last week and 40 more today."""
        first = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}],
            started_at=days_ago(7),
        )
        second = self.rent(self.mr_x, [{"product": self.machine, "quantity": 40, "plan": "daily"}])
        result = services.resolve_return(self.business, code="8801234567890")
        self.assertEqual(len(result["matches"]), 2)
        self.assertIsNone(result["exact"])
        codes = {m["rentalCode"] for m in result["matches"]}
        self.assertEqual(codes, {first.code, second.code})
        # The older one shows more days out, which is how staff tell them apart.
        by_code = {m["rentalCode"]: m for m in result["matches"]}
        self.assertEqual(by_code[first.code]["daysOut"], 7)
        self.assertEqual(by_code[second.code]["daysOut"], 1)

    def test_scanning_a_rental_code_opens_that_rental_only(self):
        first = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        self.rent(self.mr_y, [{"product": self.machine, "quantity": 50, "plan": "daily"}])
        result = services.resolve_return(self.business, code=first.code)
        self.assertEqual(result["matchedBy"], "rental")
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(result["matches"][0]["rentalCode"], first.code)

    def test_scanning_a_receipt_token_opens_that_rental(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        result = services.resolve_return(self.business, code=f"https://app.example.com/r/{rental.token}")
        self.assertEqual(result["matchedBy"], "rental")
        self.assertEqual(result["matches"][0]["rentalCode"], rental.code)

    def test_a_customer_lists_everything_they_have_out(self):
        self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        self.rent(self.mr_x, [{"product": self.table, "quantity": 5, "plan": "daily"}])
        result = services.resolve_return(self.business, customer=self.mr_x)
        self.assertEqual(result["matchedBy"], "customer")
        self.assertEqual(len(result["matches"]), 2)

    def test_returned_items_stop_showing_up(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        item = rental.items.get()
        services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 100}])
        result = services.resolve_return(self.business, code="8801234567890")
        self.assertEqual(result["matches"], [])


class ReturnTests(RentalTestCase):
    def test_a_full_return_puts_the_stock_back_and_closes_the_rental(self):
        start = days_ago(3)
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}], started_at=start)
        item = rental.items.get()
        rental_return = services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 100}])
        rental.refresh_from_db()

        self.assertEqual(self.on_hand(self.machine), 1000)
        self.assertEqual(rental.status, Rental.Status.RETURNED)
        self.assertIsNotNone(rental.returned_at)
        # 3 days out × 50 a day × 100 machines.
        self.assertEqual(rental_return.rent_total, Decimal("15000.00"))
        self.assertEqual(rental.rent_total, Decimal("15000.00"))
        self.assertEqual(rental_return.code, "RT-000001")

    def test_a_partial_return_leaves_the_rest_out(self):
        """The client's case: 100 go out, 60 come back, 40 stay with the customer."""
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        item = rental.items.get()
        services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 60}])
        rental.refresh_from_db()
        item.refresh_from_db()

        self.assertEqual(self.on_hand(self.machine), 960)
        self.assertEqual(rental.status, Rental.Status.PARTLY_RETURNED)
        self.assertEqual(item.quantity_returned, 60)
        self.assertEqual(item.quantity_out, 40)
        # The 40 still out are still findable by a scan.
        result = services.resolve_return(self.business, code="8801234567890")
        self.assertEqual(result["matches"][0]["quantityOut"], 40)

        # The rest come back later: the rental closes and stock is whole again.
        services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 40}])
        rental.refresh_from_db()
        self.assertEqual(self.on_hand(self.machine), 1000)
        self.assertEqual(rental.status, Rental.Status.RETURNED)

    def test_returning_more_than_is_out_is_refused(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        item = rental.items.get()
        with self.assertRaises(ValidationError):
            services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 101}])
        self.assertEqual(self.on_hand(self.machine), 900)

    def test_a_second_return_cannot_exceed_what_is_left(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        item = rental.items.get()
        services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 60}])
        item.refresh_from_db()
        with self.assertRaises(ValidationError):
            services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 41}])

    def test_two_tills_taking_back_the_same_items_only_the_first_counts(self):
        """Both screens show 100 out. The second to press the button is working from a
        screen that is out of date, and must be refused rather than counted twice."""
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        # Each till loaded the rental before the other acted, so both hold the same copy.
        first_till = rental.items.get()
        second_till = rental.items.get()
        services.take_return(user=self.owner, rental=rental, lines=[{"item": first_till, "quantity": 100}])
        with self.assertRaises(ValidationError):
            services.take_return(user=self.owner, rental=rental, lines=[{"item": second_till, "quantity": 100}])
        # Back on the shelf once, not twice.
        self.assertEqual(self.on_hand(self.machine), 1000)

    def test_two_tills_renting_out_the_last_of_the_stock_only_the_first_gets_it(self):
        """Both screens show 1,000 on the shelf. Two rentals of 600 cannot both go out."""
        self.rent(self.mr_x, [{"product": self.machine, "quantity": 600, "plan": "daily"}])
        with self.assertRaises(ValidationError):
            self.rent(self.mr_x, [{"product": self.machine, "quantity": 600, "plan": "daily"}])
        self.assertEqual(self.on_hand(self.machine), 400)

    def test_lost_units_are_charged_and_never_return_to_stock(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 10, "plan": "daily"}])
        item = rental.items.get()
        services.take_return(
            user=self.owner, rental=rental,
            lines=[
                {"item": item, "quantity": 8, "condition": RentalReturnLine.Condition.GOOD},
                {"item": item, "quantity": 2, "condition": RentalReturnLine.Condition.LOST},
            ],
        )
        item.refresh_from_db()
        rental.refresh_from_db()
        # Only the 8 good ones go back on the shelf.
        self.assertEqual(self.on_hand(self.machine), 998)
        self.assertEqual(item.quantity_lost, 2)
        self.assertEqual(item.quantity_out, 0)
        self.assertEqual(rental.status, Rental.Status.RETURNED)
        # 2 × the 8,000 replacement cost.
        self.assertEqual(rental.damage_fee, Decimal("16000.00"))

    def test_damaged_units_come_back_then_are_written_off(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 10, "plan": "daily"}])
        item = rental.items.get()
        services.take_return(
            user=self.owner, rental=rental,
            lines=[{"item": item, "quantity": 10, "condition": RentalReturnLine.Condition.DAMAGED}],
        )
        # They came back and were written off, so the shelf is where it started.
        self.assertEqual(self.on_hand(self.machine), 990)
        reasons = list(
            StockMovement.objects.filter(product=self.machine).order_by("-id").values_list("reason", flat=True)[:2]
        )
        self.assertEqual(set(reasons), {StockMovement.Reason.DAMAGE, StockMovement.Reason.RENT_RETURN})

    def test_a_late_return_is_charged_a_late_fee(self):
        start = days_ago(10)
        rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}],
            started_at=start, due_at=start + timedelta(days=5),
        )
        item = rental.items.get()
        rental_return = services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 1}])
        # 5 days late at the default multiplier of 1 × the 50 daily rate.
        self.assertEqual(rental_return.late_fee, Decimal("250.00"))
        self.assertEqual(rental_return.rent_total, Decimal("500.00"))

    def test_holidays_reduce_a_per_day_charge_only(self):
        start = days_ago(10)
        rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily", "holidays": 3}], started_at=start
        )
        item = rental.items.get()
        rental_return = services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 1, "holidays": 3}])
        # 10 days out less 3 holidays × 50.
        self.assertEqual(rental_return.rent_total, Decimal("350.00"))

    def test_an_item_from_another_rental_cannot_be_returned_here(self):
        first = self.rent(self.mr_x, [{"product": self.machine, "quantity": 10, "plan": "daily"}])
        second = self.rent(self.mr_y, [{"product": self.machine, "quantity": 10, "plan": "daily"}])
        with self.assertRaises(RentalItem.DoesNotExist):
            services.take_return(user=self.owner, rental=second, lines=[{"item": first.items.get(), "quantity": 1}])


class QuoteTests(TestCase):
    """The price arithmetic, which must match frontend/src/lib/rental.ts exactly."""

    def q(self, plan, rate, days, quantity=1, holidays=0):
        return RentalItem.quote(plan, Decimal(str(rate)), days, quantity, holidays)

    def test_per_day(self):
        self.assertEqual(self.q("daily", 50, 3), Decimal("150"))
        self.assertEqual(self.q("daily", 50, 3, quantity=100), Decimal("15000"))
        self.assertEqual(self.q("daily", 50, 10, holidays=3), Decimal("350"))
        # More holidays than days costs nothing, not a negative amount.
        self.assertEqual(self.q("daily", 50, 2, holidays=5), Decimal("0"))

    def test_per_week_bills_every_started_week(self):
        self.assertEqual(self.q("weekly", 300, 7), Decimal("300"))
        self.assertEqual(self.q("weekly", 300, 8), Decimal("600"))
        self.assertEqual(self.q("weekly", 300, 14), Decimal("600"))
        # Holidays don't apply to weekly.
        self.assertEqual(self.q("weekly", 300, 8, holidays=5), Decimal("600"))

    def test_per_month_bills_every_started_month(self):
        self.assertEqual(self.q("monthly", 1000, 30), Decimal("1000"))
        self.assertEqual(self.q("monthly", 1000, 31), Decimal("2000"))

    def test_fixed_is_one_price_however_long(self):
        self.assertEqual(self.q("fixed", 5000, 1), Decimal("5000"))
        self.assertEqual(self.q("fixed", 5000, 90), Decimal("5000"))
        self.assertEqual(self.q("fixed", 5000, 90, quantity=3), Decimal("15000"))

    def test_counting_days_counts_any_started_day(self):
        """Out at 10:00 and back by 10:00 the next day is one day; 11:00 is two.

        The customer had the item for part of a second day, so a second day is charged.
        This is deliberately strict, and it's why staff see the quote before confirming.
        """
        start = timezone.now()
        self.assertEqual(RentalItem.count_days(start, start), 1)
        self.assertEqual(RentalItem.count_days(start, start + timedelta(hours=23)), 1)
        self.assertEqual(RentalItem.count_days(start, start + timedelta(days=1)), 1)
        self.assertEqual(RentalItem.count_days(start, start + timedelta(days=1, hours=1)), 2)
        self.assertEqual(RentalItem.count_days(start, start + timedelta(days=3)), 3)
        # A single second past three full days starts a fourth day.
        self.assertEqual(RentalItem.count_days(start, start + timedelta(days=3, seconds=1)), 4)


class MoneyTests(RentalTestCase):
    def test_money_paid_in_advance_is_credit_until_the_rent_is_charged(self):
        start = days_ago(2)
        rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}],
            started_at=start, paid_amount=Decimal("500.00"),
        )
        rental.refresh_from_db()
        self.assertEqual(rental.paid_amount, Decimal("500.00"))
        self.assertEqual(rental.payments.get().kind, RentalPayment.Kind.ADVANCE)
        # Nothing is charged yet, so all of it is the customer's credit.
        self.assertEqual(rental.balance, Decimal("-500.00"))
        self.assertEqual(rental.credit, Decimal("500.00"))

        # Two days at 50 uses 100 of it; the other 400 is handed back at the counter.
        taken = services.take_return(
            user=self.owner, rental=rental, at=start + timedelta(days=2),
            lines=[{"item": rental.items.first(), "quantity": 1}], refunded=Decimal("400.00"),
        )
        rental.refresh_from_db()
        self.assertEqual(taken.refunded, Decimal("400.00"))
        self.assertEqual(rental.paid_amount, Decimal("100.00"))
        self.assertEqual(rental.balance, Decimal("0.00"))

    def test_unused_advance_can_be_given_back_only_once(self):
        rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}], paid_amount=Decimal("500.00")
        )
        services.refund(user=self.owner, rental=rental, amount=Decimal("500.00"))
        rental.refresh_from_db()
        self.assertEqual(rental.paid_amount, Decimal("0.00"))
        # There is nothing left to give back, so a second refund is refused.
        with self.assertRaises(ValidationError):
            services.refund(user=self.owner, rental=rental, amount=Decimal("1.00"))

    def test_money_already_charged_cannot_be_given_back(self):
        start = days_ago(2)
        rental = self.rent(
            self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}],
            started_at=start, paid_amount=Decimal("100.00"),
        )
        services.take_return(
            user=self.owner, rental=rental, at=start + timedelta(days=2),
            lines=[{"item": rental.items.first(), "quantity": 1}],
        )
        with self.assertRaises(ValidationError):
            services.refund(user=self.owner, rental=rental, amount=Decimal("50.00"))

    def test_the_balance_is_charges_less_what_was_paid(self):
        start = days_ago(2)
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}], started_at=start)
        item = rental.items.get()
        services.take_return(user=self.owner, rental=rental, lines=[{"item": item, "quantity": 1}], paid_amount=Decimal("60.00"))
        rental.refresh_from_db()
        self.assertEqual(rental.charges, Decimal("100.00"))
        self.assertEqual(rental.paid_amount, Decimal("60.00"))
        self.assertEqual(rental.balance, Decimal("40.00"))

    def test_cancelling_a_rental_puts_everything_back(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        services.cancel_rental(user=self.owner, rental=rental, reason="Entered twice")
        rental.refresh_from_db()
        self.assertEqual(self.on_hand(self.machine), 1000)
        self.assertEqual(rental.status, Rental.Status.CANCELLED)

    def test_a_rental_with_a_return_cannot_be_cancelled(self):
        rental = self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        services.take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 10}])
        with self.assertRaises(ValidationError):
            services.cancel_rental(user=self.owner, rental=rental)


class TenantIsolationTests(RentalTestCase):
    """Two businesses on one database must never see each other."""

    def setUp(self):
        super().setUp()
        self.other_business, self.other_branch, self.other_owner = create_business(
            name="Chittagong Rentals",
            owner_name="Other owner",
            owner_email="other@example.com",
            owner_password="correct-horse-battery",
        )

    def test_a_scan_only_finds_your_own_products(self):
        """The same barcode in two businesses resolves to each one's own product."""
        from apps.catalog.services import create_product

        theirs = create_product(
            user=self.other_owner, sku="SM-100", barcode="8801234567890",
            name="Their sewing machine", rentable=True, rent_daily=Decimal("99.00"),
        )
        self.assertEqual(find_by_code(self.business, "8801234567890"), self.machine)
        self.assertEqual(find_by_code(self.other_business, "8801234567890"), theirs)

    def test_a_return_scan_never_matches_another_businesss_rentals(self):
        self.rent(self.mr_x, [{"product": self.machine, "quantity": 100, "plan": "daily"}])
        result = services.resolve_return(self.other_business, code="8801234567890")
        self.assertEqual(result["matches"], [])

    def test_rental_numbers_restart_per_business(self):
        from apps.catalog.services import create_customer, create_product

        their_product = create_product(
            user=self.other_owner, sku="X-1", name="Theirs", rentable=True, rent_daily=Decimal("10.00")
        )
        adjust_stock(
            user=self.other_owner, product=their_product, branch=self.other_branch, quantity=5,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        their_customer = create_customer(user=self.other_owner, name="Their customer")
        mine = self.rent(self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}])
        theirs = services.create_rental(
            user=self.other_owner, customer=their_customer, branch=self.other_branch,
            lines=[{"product": their_product, "quantity": 1, "plan": "daily"}],
        )
        # Both are number 1: the sequence is per business, so neither leaks the other's volume.
        self.assertEqual(mine.code, "RN-000001")
        self.assertEqual(theirs.code, "RN-000001")


class RightsTests(RentalTestCase):
    def test_staff_without_the_rent_right_cannot_rent(self):
        staff = create_user(
            actor=self.owner, name="Helper", email="helper@example.com",
            password="correct-horse-battery", role=User.Role.STAFF,
            rights={"can_rent": False, "can_take_returns": False},
        )
        self.assertFalse(staff.may_rent)
        self.assertFalse(staff.may_take_returns)
        with self.assertRaises(ValidationError):
            services.take_return(
                user=staff,
                rental=self.rent(self.mr_x, [{"product": self.machine, "quantity": 1, "plan": "daily"}]),
                lines=[{"item": RentalItem.objects.first(), "quantity": 1}],
            )

    def test_owners_and_managers_always_have_the_rights(self):
        manager = create_user(
            actor=self.owner, name="Manager", email="manager@example.com",
            password="correct-horse-battery", role=User.Role.MANAGER,
            rights={"can_rent": False, "can_take_returns": False},
        )
        self.assertTrue(manager.may_rent)
        self.assertTrue(manager.may_take_returns)
