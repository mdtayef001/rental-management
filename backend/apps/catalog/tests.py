"""Tests for the catalogue, the stock ledger and the scanner's lookup endpoint."""

import json
from decimal import Decimal

from django.core.cache import cache
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import StockLevel, StockMovement
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
        create_product(user=self.owner, sku="SALE-1", barcode="111", name="For sale only", rentable=False, sellable=True)
        self.login(self.owner)
        self.assertEqual(self.client.get("/api/products/lookup/?code=111&rentableOnly=1").status_code, 404)
        self.assertEqual(self.client.get("/api/products/lookup/?code=111").status_code, 200)

    def test_an_archived_product_no_longer_scans(self):
        from apps.catalog.services import archive_product

        archive_product(user=self.owner, product=self.machine)
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

    def test_a_product_out_on_rent_cannot_be_archived(self):
        from apps.catalog.services import archive_product, create_customer
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
            archive_product(user=self.owner, product=self.machine)

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
