"""Tests for the catalogue, the stock ledger and the scanner's lookup endpoint."""

import json
from decimal import Decimal

from django.core.cache import cache
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import Product, StockLevel, StockMovement
from apps.catalog.services import adjust_stock, change_stock, create_product

PASSWORD = "correct-horse-battery"


class CatalogTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals", owner_name="Owner", owner_email="owner@example.com", owner_password=PASSWORD
        )
        self.machine = create_product(
            user=self.owner, sku="SM-100", barcode="8801234567890", name="Sewing machine",
            rentable=True, rent_daily=Decimal("50.00"), low_stock_threshold=10,
        )

    def login(self, user):
        res = self.client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return user

    def body(self, res):
        return json.loads(res.content)


class StockTests(CatalogTestCase):
    def test_stock_cannot_go_negative(self):
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=5,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        with self.assertRaises(ValidationError):
            change_stock(
                product=self.machine, branch=self.branch, change=-6,
                reason=StockMovement.Reason.RENT_OUT, user=self.owner,
            )
        self.assertEqual(StockLevel.objects.get(product=self.machine, branch=self.branch).quantity, 5)

    def test_every_change_writes_a_ledger_entry_with_the_running_balance(self):
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=100,
            reason=StockMovement.Reason.ADJUSTMENT, note="Opening count",
        )
        change_stock(
            product=self.machine, branch=self.branch, change=-30,
            reason=StockMovement.Reason.RENT_OUT, user=self.owner,
        )
        moves = list(StockMovement.objects.filter(product=self.machine).order_by("id").values("change", "balance"))
        self.assertEqual(moves, [{"change": 100, "balance": 100}, {"change": -30, "balance": 70}])

    def test_an_adjustment_records_the_difference_not_the_new_total(self):
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=100,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        # A stocktake finds 94 on the shelf: the ledger should show -6, not 94.
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=94,
            reason=StockMovement.Reason.LOST, note="Stocktake",
        )
        last = StockMovement.objects.filter(product=self.machine).order_by("-id").first()
        self.assertEqual(last.change, -6)
        self.assertEqual(last.balance, 94)
        self.assertEqual(last.reason, StockMovement.Reason.LOST)

    def test_an_adjustment_needs_a_real_reason(self):
        with self.assertRaises(ValidationError):
            adjust_stock(
                user=self.owner, product=self.machine, branch=self.branch, quantity=10,
                reason=StockMovement.Reason.RENT_OUT,
            )

    def test_staff_need_the_add_stock_right_to_adjust(self):
        staff = create_user(
            actor=self.owner, name="S", email="s@example.com", password=PASSWORD,
            role=User.Role.STAFF, rights={"can_add_stock": False},
        )
        staff.branches.set([self.branch])
        self.login(staff)
        res = self.client.post(
            "/api/stock/adjust/",
            {"product": str(self.machine.id), "branch": str(self.branch.id), "quantity": 5, "reason": "adjustment"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_staff_cannot_adjust_stock_at_a_branch_they_do_not_work_at(self):
        from apps.accounts.services import add_branch

        other = add_branch(actor=self.owner, name="Second shop")
        staff = create_user(
            actor=self.owner, name="S", email="s@example.com", password=PASSWORD,
            role=User.Role.STAFF, rights={"can_add_stock": True},
        )
        staff.branches.set([self.branch])
        self.login(staff)
        res = self.client.post(
            "/api/stock/adjust/",
            {"product": str(self.machine.id), "branch": str(other.id), "quantity": 5, "reason": "adjustment"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)


class LookupTests(CatalogTestCase):
    """The endpoint behind every scan."""

    def test_a_barcode_resolves_to_the_product_with_its_availability(self):
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=1000,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        self.login(self.owner)
        res = self.client.get("/api/products/lookup/?code=8801234567890")
        self.assertEqual(res.status_code, 200)
        body = self.body(res)
        self.assertEqual(body["name"], "Sewing machine")
        self.assertEqual(body["onHand"], 1000)
        self.assertEqual(body["stock"][str(self.branch.id)], 1000)
        self.assertEqual(Decimal(str(body["rentDaily"])), Decimal("50.00"))

    def test_a_sku_resolves_too_so_a_code_can_be_typed(self):
        self.login(self.owner)
        self.assertEqual(self.body(self.client.get("/api/products/lookup/?code=SM-100"))["sku"], "SM-100")
        # Case doesn't matter: staff type what they see on the label.
        self.assertEqual(self.body(self.client.get("/api/products/lookup/?code=sm-100"))["sku"], "SM-100")

    def test_an_unknown_code_is_a_404_with_a_message_the_scanner_can_show(self):
        self.login(self.owner)
        res = self.client.get("/api/products/lookup/?code=does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertIn("does-not-exist", str(self.body(res)))

    def test_a_search_falls_back_to_a_list(self):
        self.login(self.owner)
        body = self.body(self.client.get("/api/products/lookup/?search=sewing"))
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["name"], "Sewing machine")

    def test_rentable_only_hides_items_that_are_not_for_rent(self):
        create_product(user=self.owner, sku="SALE-1", barcode="111", name="Not for rent", rentable=False)
        self.login(self.owner)
        self.assertEqual(self.client.get("/api/products/lookup/?code=111&rentableOnly=1").status_code, 404)
        self.assertEqual(self.client.get("/api/products/lookup/?code=111").status_code, 200)

    def test_an_archived_product_no_longer_scans(self):
        from apps.catalog.services import delete_product

        # Bought in once, so it has history and is archived rather than removed.
        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=5,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        delete_product(user=self.owner, product=self.machine)
        self.login(self.owner)
        self.assertEqual(self.client.get("/api/products/lookup/?code=SM-100").status_code, 404)


class ProductTests(CatalogTestCase):
    def test_a_rentable_product_needs_at_least_one_rate(self):
        self.login(self.owner)
        res = self.client.post(
            "/api/products/", {"sku": "NEW-1", "name": "No rate", "rentable": True}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_duplicate_skus_and_barcodes_are_refused(self):
        self.login(self.owner)
        sku = self.client.post(
            "/api/products/",
            {"sku": "SM-100", "name": "Clash", "rentable": True, "rentDaily": "10.00"},
            format="json",
        )
        self.assertEqual(sku.status_code, 400)
        barcode = self.client.post(
            "/api/products/",
            {"sku": "OTHER", "name": "Clash", "barcode": "8801234567890", "rentable": True, "rentDaily": "10.00"},
            format="json",
        )
        self.assertEqual(barcode.status_code, 400)

    def test_several_products_may_have_no_barcode(self):
        self.login(self.owner)
        for sku in ("A-1", "A-2"):
            res = self.client.post(
                "/api/products/",
                {"sku": sku, "name": f"Unlabelled {sku}", "barcode": "", "rentable": True, "rentDaily": "10.00"},
                format="json",
            )
            self.assertEqual(res.status_code, 201, res.content)

    def test_a_product_out_on_rent_cannot_be_deleted(self):
        from apps.catalog.services import create_customer, delete_product
        from apps.rentals.services import create_rental

        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=10,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        customer = create_customer(user=self.owner, name="Mr. X")
        create_rental(
            user=self.owner, customer=customer, branch=self.branch,
            lines=[{"product": self.machine, "quantity": 5, "plan": "daily"}],
        )
        with self.assertRaises(ValidationError):
            delete_product(user=self.owner, product=self.machine)

    def test_a_product_nobody_has_used_is_deleted_outright(self):
        """A typo should be able to disappear, not haunt the catalogue as an archived row."""
        from apps.catalog.services import delete_product

        typo = create_product(user=self.owner, sku="TYPO-1", name="Sewing machien", rentable=True, rent_daily=Decimal("10.00"))
        archived = delete_product(user=self.owner, product=typo)
        self.assertFalse(archived)
        self.assertFalse(Product.objects.filter(pk=typo.pk).exists())

    def test_a_product_with_history_is_archived_and_old_rentals_still_name_it(self):
        from apps.catalog.services import create_customer, delete_product
        from apps.rentals.models import RentalItem
        from apps.rentals.services import create_rental, take_return

        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=10,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        customer = create_customer(user=self.owner, name="Mr. X")
        rental = create_rental(
            user=self.owner, customer=customer, branch=self.branch,
            lines=[{"product": self.machine, "quantity": 4, "plan": "daily"}],
        )
        take_return(user=self.owner, rental=rental, lines=[{"item": rental.items.get(), "quantity": 4}])

        archived = delete_product(user=self.owner, product=self.machine)
        self.assertTrue(archived)
        self.machine.refresh_from_db()
        self.assertIsNotNone(self.machine.archived_at)
        # The receipt still reads correctly: the line carries its own copy of the name.
        item = RentalItem.objects.get(rental=rental)
        self.assertEqual(item.product_name, "Sewing machine")
        self.assertEqual(item.product_sku, "SM-100")

    def test_deleting_a_product_through_the_api(self):
        self.login(self.owner)
        typo = create_product(user=self.owner, sku="TYPO-2", name="Spare", rentable=True, rent_daily=Decimal("10.00"))
        res = self.client.delete(f"/api/products/{typo.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Product.objects.filter(pk=typo.pk).exists())

    def test_the_product_list_reports_on_hand_and_out_on_rent(self):
        from apps.catalog.services import create_customer
        from apps.rentals.services import create_rental

        adjust_stock(
            user=self.owner, product=self.machine, branch=self.branch, quantity=1000,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        customer = create_customer(user=self.owner, name="Mr. X")
        create_rental(
            user=self.owner, customer=customer, branch=self.branch,
            lines=[{"product": self.machine, "quantity": 100, "plan": "daily"}],
        )
        self.login(self.owner)
        row = self.body(self.client.get("/api/products/"))[0]
        # 100 left the shelf, so 900 are on hand and 100 are out.
        self.assertEqual(row["onHand"], 900)
        self.assertEqual(row["outOnRent"], 100)


class PaginationTests(CatalogTestCase):
    def test_a_list_is_paginated_when_asked_and_whole_when_not(self):
        for i in range(60):
            create_product(user=self.owner, sku=f"P-{i}", name=f"Product {i}", rentable=False)
        self.login(self.owner)

        whole = self.body(self.client.get("/api/products/"))
        self.assertEqual(len(whole), 61)

        page = self.body(self.client.get("/api/products/?page=1&page_size=20"))
        self.assertEqual(page["count"], 61)
        self.assertEqual(page["page"], 1)
        self.assertEqual(len(page["results"]), 20)

    def test_a_page_past_the_end_returns_the_last_page_rather_than_an_error(self):
        self.login(self.owner)
        page = self.body(self.client.get("/api/products/?page=99&page_size=10"))
        self.assertEqual(page["page"], 1)

    def test_page_size_is_capped(self):
        self.login(self.owner)
        res = self.client.get("/api/products/?page=1&page_size=9999")
        self.assertEqual(res.status_code, 200)
        # Capped at 200 by Pagination.max_page_size, so one caller can't ask for everything.
        self.assertLessEqual(len(self.body(res)["results"]), 200)


class CustomerRateTests(APITestCase):
    """A company's own price: used when renting to them, and nobody else's business."""

    def setUp(self):
        from apps.catalog.models import Customer

        cache.clear()
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals", owner_name="Owner", owner_email="owner@example.com", owner_password=PASSWORD
        )
        self.staff = create_user(
            actor=self.owner, name="Staff", email="staff@example.com", password=PASSWORD, role="staff"
        )
        self.machine = create_product(
            user=self.owner, sku="SM-100", name="Sewing machine", rentable=True, rent_daily=Decimal("50.00")
        )
        adjust_stock(user=self.owner, product=self.machine, branch=self.branch, quantity=100, reason="adjustment", note="Opening count")
        self.x = Customer.objects.create(business=self.business, name="X Company")
        self.y = Customer.objects.create(business=self.business, name="Y Company")
        self.client.force_authenticate(self.owner)

    def put(self, customer, rate):
        return self.client.put(
            f"/api/customers/{customer.id}/rates/",
            {"product": str(self.machine.id), "plan": "daily", "rate": rate},
            format="json",
        )

    def rent(self, customer, **line):
        return self.client.post(
            "/api/rentals/",
            {
                "customer": str(customer.id),
                "branch": str(self.branch.id),
                "lines": [{"product": str(self.machine.id), "quantity": 10, "plan": "daily", **line}],
            },
            format="json",
        )

    def test_a_customer_pays_their_own_price_and_others_the_default(self):
        self.assertEqual(self.put(self.x, "42.50").json()[0]["rate"], 42.5)
        self.assertEqual(self.rent(self.x).json()["items"][0]["rate"], 42.5)
        self.assertEqual(self.rent(self.y).json()["items"][0]["rate"], 50)

    def test_a_typed_rate_still_wins_on_the_day(self):
        self.put(self.x, "42.50")
        self.assertEqual(self.rent(self.x, rate="40.00").json()["items"][0]["rate"], 40)
        # ...and the agreed price is untouched unless they asked to remember it.
        self.assertEqual(self.client.get(f"/api/customers/{self.x.id}/rates/").json()[0]["rate"], 42.5)

    def test_remembering_the_rates_of_a_rental(self):
        response = self.client.post(
            "/api/rentals/",
            {
                "customer": str(self.x.id),
                "branch": str(self.branch.id),
                "rememberRates": True,
                "lines": [{"product": str(self.machine.id), "quantity": 10, "plan": "daily", "rate": "45.00"}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.client.get(f"/api/customers/{self.x.id}/rates/").json()[0]["rate"], 45)

    def test_null_or_the_default_goes_back_to_the_products_own_rate(self):
        self.put(self.x, "42.50")
        self.assertEqual(self.put(self.x, None).json(), [])
        self.assertEqual(self.put(self.x, "50.00").json(), [])

    def test_staff_can_read_but_not_change_prices(self):
        self.put(self.x, "42.50")
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(f"/api/customers/{self.x.id}/rates/").status_code, 200)
        self.assertEqual(self.put(self.x, "1.00").status_code, 403)

    def test_another_business_cannot_see_or_set_them(self):
        self.put(self.x, "42.50")
        _, _, them = create_business(
            name="Sylhet Tools", owner_name="Them", owner_email="them@example.com", owner_password=PASSWORD
        )
        self.client.force_authenticate(them)
        self.assertEqual(self.client.get(f"/api/customers/{self.x.id}/rates/").status_code, 404)
        self.assertEqual(self.put(self.x, "1.00").status_code, 404)


class SimpleProductTests(CatalogTestCase):
    """Adding a product asks for a name and a rate. The rest is optional."""

    def test_a_product_added_without_a_sku_is_numbered(self):
        self.login(self.owner)
        first = self.client.post("/api/products/", {"name": "Steam iron", "rentDaily": "30.00"}, format="json")
        second = self.client.post("/api/products/", {"name": "Generator", "rentDaily": "900.00", "sku": ""}, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self.body(first)["sku"], "P-0001")
        self.assertEqual(self.body(second)["sku"], "P-0002")

    def test_the_count_on_the_shelf_can_be_given_when_adding(self):
        self.login(self.owner)
        res = self.client.post(
            "/api/products/", {"name": "Work table", "rentDaily": "20.00", "openingStock": 40}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        product = Product.objects.get(pk=self.body(res)["id"])
        self.assertEqual(self.body(res)["onHand"], 40)
        # It went through the ledger, so the product's history says where its stock came from.
        move = StockMovement.objects.get(product=product)
        self.assertEqual((move.change, move.note), (40, "Opening stock"))

    def test_editing_a_product_never_changes_its_stock(self):
        change_stock(product=self.machine, branch=self.branch, change=5, reason=StockMovement.Reason.ADJUSTMENT)
        self.login(self.owner)
        res = self.client.patch(
            f"/api/products/{self.machine.id}/", {"name": "Sewing machine", "sku": "", "openingStock": 99}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.machine.refresh_from_db()
        # A blank SKU on an edit keeps the one it has.
        self.assertEqual(self.machine.sku, "SM-100")
        self.assertEqual(StockLevel.objects.get(product=self.machine).quantity, 5)


# A 1×1 PNG: the smallest picture there is.
PIXEL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


class LogoTests(CatalogTestCase):
    """The owner's logo: uploaded once, then printed on every receipt, bill and report."""

    def test_the_owner_uploads_a_logo_and_the_team_can_see_it(self):
        self.login(self.owner)
        res = self.client.put("/api/business/logo/", {"image": PIXEL}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        version = self.body(res)["logoVersion"]
        self.assertTrue(version)

        staff = create_user(
            actor=self.owner, name="Staff", email="staff@example.com", password=PASSWORD, role=User.Role.STAFF
        )
        self.login(staff)
        image = self.client.get("/api/business/logo/")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image["Content-Type"], "image/png")
        # ...but only the owner may change it.
        self.assertEqual(self.client.put("/api/business/logo/", {"image": PIXEL}, format="json").status_code, 403)

    def test_only_a_real_picture_is_accepted(self):
        self.login(self.owner)
        for bad in (
            "not a picture",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "data:image/png;base64,aGVsbG8=",
        ):
            res = self.client.put("/api/business/logo/", {"image": bad}, format="json")
            self.assertEqual(res.status_code, 400, bad)
        self.assertEqual(self.client.get("/api/business/logo/").status_code, 404)

    def test_removing_the_logo(self):
        self.login(self.owner)
        self.client.put("/api/business/logo/", {"image": PIXEL}, format="json")
        res = self.client.delete("/api/business/logo/")
        self.assertEqual(self.body(res)["logoVersion"], "")
        self.assertEqual(self.client.get("/api/business/logo/").status_code, 404)

    def test_another_business_never_sees_this_logo(self):
        self.login(self.owner)
        self.client.put("/api/business/logo/", {"image": PIXEL}, format="json")
        _, _, other = create_business(
            name="Other", owner_name="Other", owner_email="other@example.com", owner_password=PASSWORD
        )
        self.login(other)
        self.assertEqual(self.client.get("/api/business/logo/").status_code, 404)
