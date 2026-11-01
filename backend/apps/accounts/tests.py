"""Tests for identity, tenancy and the security boundary.

These go through the HTTP API rather than calling services, because that is where an
attacker would be: the point is that a crafted request is refused even when the service
underneath would happily have done the work.
"""

from decimal import Decimal

from django.core.cache import cache
from rest_framework.test import APITestCase

from apps.accounts.models import Branch, Business, User
from apps.accounts.services import create_business, create_user
from apps.catalog.models import StockMovement
from apps.catalog.services import adjust_stock, create_customer, create_product

PASSWORD = "correct-horse-battery"


class ApiTestCase(APITestCase):
    def setUp(self):
        # The login throttle counts in the cache; clear it so one test's logins don't
        # throttle the next test's.
        cache.clear()
        self.superadmin = User.objects.create_superuser(email="root@example.com", password=PASSWORD, name="Root")
        self.business, self.branch, self.owner = create_business(
            name="Dhaka Rentals", owner_name="Owner", owner_email="owner@example.com", owner_password=PASSWORD
        )

    def login(self, email, password=PASSWORD):
        res = self.client.post("/api/auth/login/", {"email": email, "password": password}, format="json")
        if res.status_code == 200:
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return res

    def as_user(self, user):
        self.login(user.email)
        return user

    def anonymous(self):
        self.client.credentials()

    def json(self, res):
        """The rendered response body.

        `res.data` is DRF's pre-render dict and still snake_case; the frontend reads the
        rendered JSON, which is camelCase. Tests about the wire format use this.
        """
        import json as _json

        return _json.loads(res.content)


class LoginTests(ApiTestCase):
    def test_login_returns_a_token_pair(self):
        res = self.login("owner@example.com")
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)

    def test_the_token_carries_the_claims_the_proxy_routes_on(self):
        import jwt
        from django.conf import settings

        res = self.login("owner@example.com")
        claims = jwt.decode(res.data["access"], settings.JWT_SIGNING_KEY, algorithms=["HS256"])
        self.assertEqual(claims["role"], "owner")
        self.assertEqual(claims["tenant_id"], str(self.business.id))
        self.assertTrue(claims["can_rent"])

    def test_a_wrong_password_is_refused_without_saying_whether_the_email_exists(self):
        wrong = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": "nope"}, format="json")
        unknown = self.client.post("/api/auth/login/", {"email": "ghost@example.com", "password": "nope"}, format="json")
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        # The same answer either way, so the form can't be used to enumerate accounts.
        self.assertEqual(str(wrong.data), str(unknown.data))

    def test_login_is_throttled(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": "nope"}, format="json")
        res = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": "nope"}, format="json")
        self.assertEqual(res.status_code, 429)

    def test_a_suspended_business_cannot_log_in(self):
        self.business.suspended = True
        self.business.save()
        res = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_a_disabled_account_cannot_log_in(self):
        staff = create_user(actor=self.owner, name="Gone", email="gone@example.com", password=PASSWORD, role=User.Role.STAFF)
        staff.is_active = False
        staff.save()
        res = self.client.post("/api/auth/login/", {"email": "gone@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_logout_stops_the_refresh_token_working(self):
        res = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": PASSWORD}, format="json")
        refresh = res.data["refresh"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
        again = self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(again.status_code, 401)

    def test_every_endpoint_needs_a_login(self):
        self.anonymous()
        for path in ("/api/auth/me/", "/api/products/", "/api/rentals/", "/api/customers/", "/api/branches/"):
            self.assertEqual(self.client.get(path).status_code, 401, path)


class MeTests(ApiTestCase):
    def test_me_returns_the_user_and_their_business(self):
        self.as_user(self.owner)
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        body = self.json(res)
        self.assertEqual(body["user"]["email"], "owner@example.com")
        self.assertEqual(body["business"]["name"], "Dhaka Rentals")
        # camelCase on the wire, which is what the frontend's types expect.
        self.assertTrue(body["user"]["isMainOwner"])
        self.assertIn("canRent", body["user"])
        self.assertEqual(body["business"]["status"], "active")

    def test_suspending_a_business_locks_out_a_still_valid_token(self):
        """The reason the frontend asks `me` on every request rather than trusting the JWT."""
        self.as_user(self.owner)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
        self.business.suspended = True
        self.business.save()
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 403)
        self.assertEqual(self.client.get("/api/products/").status_code, 403)


class BusinessCreationTests(ApiTestCase):
    def test_the_super_admin_creates_a_business_with_its_owner_and_a_branch(self):
        self.as_user(self.superadmin)
        res = self.client.post(
            "/api/platform/businesses/",
            {
                "name": "Chittagong Rentals",
                "ownerName": "New Owner",
                "ownerEmail": "new@example.com",
                "ownerPassword": PASSWORD,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        business = Business.objects.get(name="Chittagong Rentals")
        self.assertEqual(business.users.count(), 1)
        self.assertEqual(business.users.get().role, User.Role.OWNER)
        # A business is never created without somewhere to put stock.
        self.assertEqual(business.branches.count(), 1)

    def test_a_duplicate_owner_email_creates_nothing(self):
        self.as_user(self.superadmin)
        before = Business.objects.count()
        res = self.client.post(
            "/api/platform/businesses/",
            {"name": "Clash", "ownerName": "X", "ownerEmail": "owner@example.com", "ownerPassword": PASSWORD},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Business.objects.count(), before)

    def test_a_weak_owner_password_is_refused(self):
        self.as_user(self.superadmin)
        res = self.client.post(
            "/api/platform/businesses/",
            {"name": "Weak", "ownerName": "X", "ownerEmail": "weak@example.com", "ownerPassword": "123"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_an_owner_cannot_reach_the_platform_api(self):
        """Only the super admin creates businesses — that was the whole point of the role."""
        self.as_user(self.owner)
        self.assertEqual(self.client.get("/api/platform/businesses/").status_code, 403)
        res = self.client.post(
            "/api/platform/businesses/",
            {"name": "Mine too", "ownerName": "X", "ownerEmail": "x@example.com", "ownerPassword": PASSWORD},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_deleting_a_business_needs_its_name_typed_back(self):
        self.as_user(self.superadmin)
        res = self.client.delete(f"/api/platform/businesses/{self.business.id}/", {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(Business.objects.filter(pk=self.business.pk).exists())

        res = self.client.delete(
            f"/api/platform/businesses/{self.business.id}/", {"confirmName": "Dhaka Rentals"}, format="json"
        )
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Business.objects.filter(pk=self.business.pk).exists())


class UserManagementTests(ApiTestCase):
    def test_an_owner_creates_users(self):
        self.as_user(self.owner)
        res = self.client.post(
            "/api/users/",
            {"name": "Staffer", "email": "staff@example.com", "password": PASSWORD, "role": "staff", "canRent": True},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(User.objects.get(email="staff@example.com").business, self.business)

    def test_an_owner_cannot_create_a_super_admin(self):
        self.as_user(self.owner)
        res = self.client.post(
            "/api/users/",
            {"name": "Sneaky", "email": "sneaky@example.com", "password": PASSWORD, "role": "superadmin"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(User.objects.filter(email="sneaky@example.com").exists())

    def test_a_manager_can_only_create_staff(self):
        manager = create_user(actor=self.owner, name="Mgr", email="mgr@example.com", password=PASSWORD, role=User.Role.MANAGER)
        self.as_user(manager)
        ok = self.client.post(
            "/api/users/", {"name": "S", "email": "s1@example.com", "password": PASSWORD, "role": "staff"}, format="json"
        )
        self.assertEqual(ok.status_code, 201)
        refused = self.client.post(
            "/api/users/", {"name": "M2", "email": "m2@example.com", "password": PASSWORD, "role": "manager"}, format="json"
        )
        self.assertEqual(refused.status_code, 400)

    def test_staff_cannot_reach_user_management_at_all(self):
        staff = create_user(actor=self.owner, name="S", email="s@example.com", password=PASSWORD, role=User.Role.STAFF)
        self.as_user(staff)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)

    def test_nobody_can_change_the_main_owner(self):
        manager = create_user(actor=self.owner, name="Mgr", email="mgr@example.com", password=PASSWORD, role=User.Role.MANAGER)
        self.as_user(manager)
        res = self.client.patch(f"/api/users/{self.owner.id}/", {"name": "Hijacked"}, format="json")
        # The manager's queryset excludes owners entirely, so it isn't even visible.
        self.assertIn(res.status_code, (403, 404))
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.name, "Owner")

    def test_a_manager_cannot_reset_another_managers_password(self):
        manager = create_user(actor=self.owner, name="Mgr", email="mgr@example.com", password=PASSWORD, role=User.Role.MANAGER)
        other = create_user(actor=self.owner, name="Mgr2", email="mgr2@example.com", password=PASSWORD, role=User.Role.MANAGER)
        self.as_user(manager)
        res = self.client.post(f"/api/users/{other.id}/password/", {"password": "new-strong-password"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_deleting_a_user_disables_them_instead(self):
        staff = create_user(actor=self.owner, name="S", email="s@example.com", password=PASSWORD, role=User.Role.STAFF)
        self.as_user(self.owner)
        res = self.client.delete(f"/api/users/{staff.id}/")
        self.assertEqual(res.status_code, 204)
        staff.refresh_from_db()
        # Kept, so the rentals they handled still have a name against them.
        self.assertFalse(staff.is_active)
        self.assertTrue(User.objects.filter(pk=staff.pk).exists())

    def test_the_manager_users_permission_gates_writes_not_reads(self):
        manager = create_user(actor=self.owner, name="Mgr", email="mgr@example.com", password=PASSWORD, role=User.Role.MANAGER)
        self.business.settings["permissions"]["managerUsers"] = False
        self.business.save()
        self.as_user(manager)
        self.assertEqual(self.client.get("/api/users/").status_code, 200)
        res = self.client.post(
            "/api/users/", {"name": "S", "email": "s2@example.com", "password": PASSWORD, "role": "staff"}, format="json"
        )
        self.assertEqual(res.status_code, 403)


class CrossTenantTests(ApiTestCase):
    """One business must not be able to read, write or point at another's rows."""

    def setUp(self):
        super().setUp()
        self.other, self.other_branch, self.other_owner = create_business(
            name="Rivals", owner_name="Rival", owner_email="rival@example.com", owner_password=PASSWORD
        )
        self.their_product = create_product(
            user=self.other_owner, sku="THEIRS", name="Their machine", rentable=True, rent_daily=Decimal("10.00")
        )
        self.their_customer = create_customer(user=self.other_owner, name="Their customer")
        adjust_stock(
            user=self.other_owner, product=self.their_product, branch=self.other_branch,
            quantity=10, reason=StockMovement.Reason.ADJUSTMENT,
        )

    def test_another_businesss_rows_are_invisible(self):
        self.as_user(self.owner)
        self.assertEqual(self.json(self.client.get("/api/products/")), [])
        self.assertEqual(self.json(self.client.get("/api/customers/")), [])
        self.assertEqual(self.client.get(f"/api/products/{self.their_product.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/customers/{self.their_customer.id}/").status_code, 404)

    def test_another_businesss_rows_cannot_be_edited(self):
        self.as_user(self.owner)
        res = self.client.patch(f"/api/products/{self.their_product.id}/", {"name": "Mine now"}, format="json")
        self.assertEqual(res.status_code, 404)
        self.their_product.refresh_from_db()
        self.assertEqual(self.their_product.name, "Their machine")

    def test_a_rental_cannot_be_built_from_another_businesss_ids(self):
        """The attack the tenant-scoped relation fields exist to stop."""
        self.as_user(self.owner)
        res = self.client.post(
            "/api/rentals/",
            {
                "customer": str(self.their_customer.id),
                "branch": str(self.other_branch.id),
                "lines": [{"product": str(self.their_product.id), "quantity": 1, "plan": "daily"}],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_another_businesss_branch_cannot_be_used(self):
        self.as_user(self.owner)
        res = self.client.post("/api/branches/", {"name": "Fine"}, format="json")
        self.assertEqual(res.status_code, 201)
        # The new branch belongs to the caller's business, not the one they named.
        self.assertEqual(Branch.objects.get(name="Fine").business, self.business)
