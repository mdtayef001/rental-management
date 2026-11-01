"""Tests for purchasing: cost averaging, payment allocation and supplier returns."""

from decimal import Decimal

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from apps.accounts.services import create_business
from apps.catalog.models import StockLevel, StockMovement
from apps.catalog.services import adjust_stock, create_product
from apps.purchasing import services
from apps.purchasing.models import PaymentAllocation, Purchase, Supplier, SupplierPayment, SupplierReturn

PASSWORD = "correct-horse-battery"


class PurchasingTestCase(TestCase):
    def setUp(self):
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals", owner_name="Owner", owner_email="owner@example.com", owner_password=PASSWORD
        )
        self.machine = create_product(
            user=self.owner, sku="SM-100", name="Sewing machine", rentable=True, rent_daily=Decimal("50.00")
        )
        self.supplier = Supplier.objects.create(business=self.business, name="Singer Agent")

    def buy(self, quantity, unit_cost, **kwargs):
        return services.create_purchase(
            user=self.owner,
            supplier=kwargs.pop("supplier", self.supplier),
            branch=self.branch,
            lines=[{"product": self.machine, "quantity": quantity, "unit_cost": Decimal(str(unit_cost))}],
            **kwargs,
        )

    def on_hand(self):
        return StockLevel.objects.get(product=self.machine, branch=self.branch).quantity


class CostAveragingTests(PurchasingTestCase):
    def test_the_first_purchase_sets_the_cost(self):
        self.buy(200, "50.00")
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.cost, Decimal("50.00"))
        self.assertEqual(self.on_hand(), 200)

    def test_a_second_purchase_averages_by_quantity(self):
        """200 at 50 plus 100 at 80 is 60 — not 80, and not 65."""
        self.buy(200, "50.00")
        self.buy(100, "80.00")
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.cost, Decimal("60.00"))
        self.assertEqual(self.on_hand(), 300)

    def test_buying_at_the_same_price_leaves_the_cost_alone(self):
        self.buy(100, "50.00")
        self.buy(100, "50.00")
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.cost, Decimal("50.00"))

    def test_stock_counted_in_before_any_purchase_is_part_of_the_average(self):
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=100,
            reason=StockMovement.Reason.ADJUSTMENT, note="Opening count",
        )
        # Opening stock has a cost of 0 until a purchase gives it one, so 100 at 0 plus
        # 100 at 80 averages to 40. The owner can correct the cost on the product.
        self.buy(100, "80.00")
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.cost, Decimal("40.00"))

    def test_a_purchase_raises_the_stock_and_writes_the_ledger(self):
        purchase = self.buy(200, "50.00")
        move = StockMovement.objects.filter(product=self.machine).latest("id")
        self.assertEqual(move.change, 200)
        self.assertEqual(move.reason, StockMovement.Reason.PURCHASE)
        self.assertEqual(move.note, purchase.code)

    def test_purchase_numbers_are_gapless_per_business(self):
        self.buy(1, "1.00")
        self.buy(1, "1.00")
        self.assertEqual([p.code for p in Purchase.objects.order_by("number")], ["P-000001", "P-000002"])


class PaymentTests(PurchasingTestCase):
    def test_a_bill_starts_unpaid_and_records_what_is_owed(self):
        purchase = self.buy(100, "50.00")
        self.assertEqual(purchase.total, Decimal("5000.00"))
        self.assertEqual(purchase.due, Decimal("5000.00"))
        self.assertEqual(purchase.payment_status, "unpaid")

    def test_paying_at_the_till_settles_the_bill(self):
        purchase = self.buy(100, "50.00", paid_amount=Decimal("5000.00"), method="cash")
        self.assertEqual(purchase.paid_amount, Decimal("5000.00"))
        self.assertEqual(purchase.due, Decimal("0.00"))
        self.assertEqual(purchase.payment_status, "paid")

    def test_a_part_payment_is_recorded_as_partly_paid(self):
        purchase = self.buy(100, "50.00", paid_amount=Decimal("2000.00"), method="cash")
        self.assertEqual(purchase.due, Decimal("3000.00"))
        self.assertEqual(purchase.payment_status, "partly_paid")

    def test_paying_more_than_the_bill_is_refused(self):
        with self.assertRaises(ValidationError):
            self.buy(10, "50.00", paid_amount=Decimal("99999.00"))

    def test_a_purchase_with_no_supplier_must_be_paid_in_full(self):
        """There is nobody to owe, so an unpaid balance would never be collectable."""
        with self.assertRaises(ValidationError):
            self.buy(10, "50.00", supplier=None, paid_amount=Decimal("100.00"))
        ok = self.buy(10, "50.00", supplier=None, paid_amount=Decimal("500.00"))
        self.assertEqual(ok.payment_status, "paid")

    def test_a_later_payment_clears_the_oldest_bills_first(self):
        first = self.buy(100, "10.00")   # 1,000
        second = self.buy(100, "20.00")  # 2,000
        services.pay_supplier(user=self.owner, supplier=self.supplier, amount=Decimal("1500.00"), method="cash")
        first.refresh_from_db()
        second.refresh_from_db()
        # The older bill is cleared, and the remainder goes to the next one.
        self.assertEqual(first.paid_amount, Decimal("1000.00"))
        self.assertEqual(second.paid_amount, Decimal("500.00"))
        self.assertEqual(PaymentAllocation.objects.count(), 2)

    def test_a_payment_can_be_aimed_at_one_bill(self):
        first = self.buy(100, "10.00")
        second = self.buy(100, "20.00")
        services.pay_supplier(
            user=self.owner, supplier=self.supplier, amount=Decimal("500.00"), method="cash", purchase=second
        )
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.paid_amount, Decimal("0.00"))
        self.assertEqual(second.paid_amount, Decimal("500.00"))

    def test_paying_more_than_is_owed_is_kept_on_account_not_pushed_onto_a_bill(self):
        purchase = self.buy(100, "10.00")  # 1,000 owed
        payment = services.pay_supplier(
            user=self.owner, supplier=self.supplier, amount=Decimal("1500.00"), method="cash"
        )
        purchase.refresh_from_db()
        self.assertEqual(purchase.paid_amount, Decimal("1000.00"))
        # The extra 500 is recorded against the supplier, not as an overpaid bill.
        self.assertIn("on account", payment.note)
        self.assertEqual(sum(a.amount for a in payment.allocations.all()), Decimal("1000.00"))

    def test_a_zero_payment_is_refused(self):
        self.buy(10, "10.00")
        with self.assertRaises(ValidationError):
            services.pay_supplier(user=self.owner, supplier=self.supplier, amount=Decimal("0"))

    def test_the_balance_is_what_is_billed_less_what_is_paid(self):
        self.buy(100, "10.00", paid_amount=Decimal("400.00"))
        self.buy(50, "10.00")
        self.assertEqual(services.supplier_balance(self.supplier), Decimal("1100.00"))


class SupplierReturnTests(PurchasingTestCase):
    def setUp(self):
        super().setUp()
        self.purchase = self.buy(100, "50.00")
        self.item = self.purchase.items.get()

    def test_sending_stock_back_takes_it_off_the_shelf(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty motors")
        self.assertEqual(self.on_hand(), 90)
        self.assertEqual(sr.code, "SR-000001")
        self.assertEqual(sr.value, Decimal("500.00"))
        self.assertEqual(sr.outstanding, Decimal("500.00"))
        self.assertEqual(sr.status, SupplierReturn.Status.OPEN)

    def test_more_cannot_go_back_than_was_bought(self):
        with self.assertRaises(ValidationError):
            services.create_supplier_return(user=self.owner, item=self.item, quantity=101, reason="Too many")
        self.assertEqual(self.on_hand(), 100)

    def test_two_returns_cannot_exceed_the_bill_between_them(self):
        services.create_supplier_return(user=self.owner, item=self.item, quantity=60, reason="Faulty")
        with self.assertRaises(ValidationError):
            services.create_supplier_return(user=self.owner, item=self.item, quantity=50, reason="More")

    def test_replacements_put_the_stock_back_and_settle_the_return(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, replaced_quantity=10)
        sr.refresh_from_db()
        self.assertEqual(self.on_hand(), 100)
        self.assertEqual(sr.outstanding, Decimal("0.00"))
        self.assertEqual(sr.status, SupplierReturn.Status.SETTLED)

    def test_a_refund_settles_the_return_without_returning_stock(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, refunded_amount=Decimal("500.00"))
        sr.refresh_from_db()
        self.assertEqual(self.on_hand(), 90)
        self.assertEqual(sr.status, SupplierReturn.Status.SETTLED)

    def test_a_credit_pays_down_what_the_business_owes(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, credited_amount=Decimal("500.00"))
        self.purchase.refresh_from_db()
        sr.refresh_from_db()
        # The credit behaves exactly as cash would against the oldest bill.
        self.assertEqual(self.purchase.paid_amount, Decimal("500.00"))
        self.assertEqual(sr.status, SupplierReturn.Status.SETTLED)
        credit = SupplierPayment.objects.get(supplier_return=sr)
        self.assertEqual(credit.method, SupplierPayment.Method.CREDIT)

    def test_settling_for_more_than_is_outstanding_is_refused(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        with self.assertRaises(ValidationError):
            services.settle_return(user=self.owner, supplier_return=sr, refunded_amount=Decimal("5000.00"))

    def test_a_partly_settled_return_stays_open(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, replaced_quantity=4)
        sr.refresh_from_db()
        self.assertEqual(sr.outstanding, Decimal("300.00"))
        self.assertEqual(sr.units_to_replace, 6)
        self.assertEqual(sr.status, SupplierReturn.Status.OPEN)

    def test_a_return_can_be_closed_as_a_loss(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, close_note="Supplier went out of business")
        sr.refresh_from_db()
        self.assertEqual(sr.status, SupplierReturn.Status.CLOSED)
        self.assertIn("out of business", sr.closed_note)

    def test_a_finished_return_cannot_be_settled_again(self):
        sr = services.create_supplier_return(user=self.owner, item=self.item, quantity=10, reason="Faulty")
        services.settle_return(user=self.owner, supplier_return=sr, refunded_amount=Decimal("500.00"))
        with self.assertRaises(ValidationError):
            services.settle_return(user=self.owner, supplier_return=sr, refunded_amount=Decimal("1.00"))

    def test_a_supplier_with_bills_cannot_be_deleted(self):
        with self.assertRaises(ValidationError):
            services.delete_supplier(user=self.owner, supplier=self.supplier)
