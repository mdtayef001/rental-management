"""Tests for purchasing: cost averaging, payment allocation and supplier returns."""

from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
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


class SupplierReturnApiTests(APITestCase):
    """The screen's own endpoints: the filtered list and the figures above it.

    These are read by a screen that staff never see, so the role gate is part of the test:
    a manager without the owner's purchasing switch gets nothing at all.
    """

    def setUp(self):
        # Login is rate-limited per address, and the limiter counts in the cache.
        cache.clear()
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals", owner_name="Owner", owner_email="owner@example.com", owner_password=PASSWORD
        )
        self.supplier = Supplier.objects.create(business=self.business, name="Singer Agent")
        self.other = Supplier.objects.create(business=self.business, name="Brother Depot")
        self.machine = create_product(user=self.owner, sku="SM-100", name="Sewing machine", rentable=True)
        self.table = create_product(user=self.owner, sku="TB-1", name="Cutting table", rentable=True)

        self.bill = self._buy(self.supplier, self.machine, 100, "50.00")
        self.faulty = services.create_supplier_return(
            user=self.owner, item=self.bill.items.get(), quantity=10, reason="Faulty motors"
        )
        self.other_bill = self._buy(self.other, self.table, 20, "200.00")
        self.wrong_size = services.create_supplier_return(
            user=self.owner, item=self.other_bill.items.get(), quantity=2, reason="Wrong size"
        )
        # One of the two is finished, so the status filter has something to separate.
        services.settle_return(user=self.owner, supplier_return=self.wrong_size, refunded_amount=Decimal("400.00"))

        self.login(self.owner)

    def _buy(self, supplier, product, quantity, unit_cost):
        return services.create_purchase(
            user=self.owner,
            supplier=supplier,
            branch=self.branch,
            lines=[{"product": product, "quantity": quantity, "unit_cost": Decimal(unit_cost)}],
            paid_amount=Decimal(unit_cost) * quantity,
            method="cash",
        )

    def login(self, user):
        res = self.client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return user

    def codes(self, **params):
        res = self.client.get("/api/purchases/returns-list/", params)
        self.assertEqual(res.status_code, 200)
        return [row["code"] for row in res.json()]

    def test_the_list_is_newest_first(self):
        self.assertEqual(self.codes(), [self.wrong_size.code, self.faulty.code])

    def test_only_the_open_ones_can_be_listed(self):
        self.assertEqual(self.codes(status="open"), [self.faulty.code])
        self.assertEqual(self.codes(status="settled"), [self.wrong_size.code])

    def test_a_meaningless_status_is_ignored_rather_than_erroring(self):
        self.assertEqual(len(self.codes(status="banana")), 2)

    def test_searching_by_product_supplier_or_reason(self):
        self.assertEqual(self.codes(search="sewing"), [self.faulty.code])
        self.assertEqual(self.codes(search="Brother"), [self.wrong_size.code])
        self.assertEqual(self.codes(search="faulty"), [self.faulty.code])

    def test_a_code_off_the_screen_finds_its_return(self):
        # However the owner retypes it.
        for text in ("SR-000001", "sr 1", "1"):
            self.assertIn(self.faulty.code, self.codes(search=text), text)

    def test_the_list_can_be_narrowed_to_one_bill(self):
        self.assertEqual(self.codes(purchase=self.bill.id), [self.faulty.code])
        self.assertEqual(self.codes(supplier=self.other.id), [self.wrong_size.code])

    def test_the_summary_counts_what_is_still_owed_by_suppliers(self):
        res = self.client.get("/api/purchases/returns-summary/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["open"], 1)
        self.assertEqual(body["units"], 12)
        # 10 × 50 sent back, plus 2 × 200 — and only the open one is still outstanding.
        self.assertEqual(Decimal(str(body["value"])), Decimal("900.00"))
        self.assertEqual(Decimal(str(body["outstanding"])), Decimal("500.00"))

    def test_the_summary_follows_the_same_filters_as_the_list(self):
        body = self.client.get("/api/purchases/returns-summary/", {"status": "settled"}).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(Decimal(str(body["outstanding"])), Decimal("0.00"))

    def test_another_businesss_returns_are_not_listed(self):
        theirs, their_branch, their_owner = create_business(
            name="Sylhet Tools", owner_name="Them", owner_email="them@example.com", owner_password=PASSWORD
        )
        self.login(their_owner)
        self.assertEqual(self.codes(), [])
        self.assertEqual(self.client.get("/api/purchases/returns-summary/").json()["count"], 0)

    def test_a_manager_needs_the_owners_purchasing_switch(self):
        manager = create_user(
            actor=self.owner, name="Manager", email="manager@example.com", password=PASSWORD, role=User.Role.MANAGER,
        )
        self.login(manager)
        self.assertEqual(self.client.get("/api/purchases/returns-list/").status_code, 403)

        self.business.settings["permissions"]["managerPurchases"] = True
        self.business.save(update_fields=["settings"])
        self.assertEqual(self.client.get("/api/purchases/returns-list/").status_code, 200)

    def test_staff_cannot_see_supplier_returns(self):
        helper = create_user(
            actor=self.owner, name="Helper", email="helper@example.com", password=PASSWORD, role=User.Role.STAFF,
        )
        self.login(helper)
        for path in ("returns-list", "returns-summary"):
            self.assertEqual(self.client.get(f"/api/purchases/{path}/").status_code, 403, path)

    def test_sending_stock_back_through_the_api(self):
        res = self.client.post(
            "/api/purchases/returns/",
            {"item": str(self.bill.items.get().id), "quantity": 5, "reason": "Bent needles"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.json())
        self.assertEqual(res.json()["code"], "SR-000003")
        self.assertEqual(StockLevel.objects.get(product=self.machine, branch=self.branch).quantity, 85)

    def test_settling_through_the_api(self):
        res = self.client.post(
            f"/api/purchases/returns/{self.faulty.id}/settle/",
            {"replacedQuantity": 4, "refundedAmount": "300.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.json())
        body = res.json()
        self.assertEqual(body["replacedQuantity"], 4)
        self.assertEqual(Decimal(str(body["outstanding"])), Decimal("0.00"))
        self.assertEqual(body["status"], "settled")
