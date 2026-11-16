"""Tests for identity, tenancy and the security boundary.

These go through the HTTP API rather than calling services, because that is where an
attacker would be: the point is that a crafted request is refused even when the service
underneath would happily have done the work.
"""

from decimal import Decimal

from django.core.cache import cache
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User
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
        self.business, self.owner = create_business(
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

    def test_login_is_throttled_per_email_across_addresses(self):
        def attempt(n):
            return self.client.post(
                "/api/auth/login/",
                {"email": "Owner@Example.com ", "password": "nope"},
                format="json",
                REMOTE_ADDR=f"10.0.{n // 250}.{n % 250 + 1}",
            )

        for n in range(20):
            self.assertEqual(attempt(n).status_code, 401)
        self.assertEqual(attempt(20).status_code, 429)
        # Someone else's login from that same new address is untouched.
        other = self.client.post(
            "/api/auth/login/", {"email": "root@example.com", "password": PASSWORD}, format="json", REMOTE_ADDR="10.9.9.9"
        )
        self.assertEqual(other.status_code, 200)

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

    def test_logout_works_without_an_access_token(self):
        """The web app's server logs out with only the refresh token, often after the access
        token has expired. That alone has to be enough to blacklist it."""
        res = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": PASSWORD}, format="json")
        refresh = res.data["refresh"]
        self.anonymous()
        out = self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
        self.assertEqual(out.status_code, 204)
        again = self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(again.status_code, 401)

    def test_there_is_no_django_admin_login(self):
        """The admin login would be a second, unthrottled way to check the super admin's
        password, so it isn't mounted and nobody is staff."""
        self.anonymous()
        res = self.client.post("/admin/login/", {"username": "root@example.com", "password": PASSWORD})
        self.assertEqual(res.status_code, 404)
        self.superadmin.refresh_from_db()
        self.assertFalse(self.superadmin.is_staff)
        self.assertFalse(self.superadmin.is_superuser)

    def test_every_endpoint_needs_a_login(self):
        self.anonymous()
        for path in ("/api/auth/me/", "/api/products/", "/api/rentals/", "/api/customers/", "/api/stock/movements/"):
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
    def test_the_super_admin_creates_a_business_with_its_owner(self):
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

    def test_the_super_admin_cannot_edit_a_business(self):
        """The owner edits their own business; the platform only creates, suspends and deletes."""
        self.as_user(self.superadmin)
        res = self.client.patch(f"/api/platform/businesses/{self.business.id}/", {"name": "Renamed"}, format="json")
        self.assertEqual(res.status_code, 405)
        self.business.refresh_from_db()
        self.assertEqual(self.business.name, "Dhaka Rentals")

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

    def test_the_manager_users_permission_gates_reads_and_writes(self):
        """Without the switch the Users screen is hidden, so the team's contact details are
        not readable through the API either."""
        manager = create_user(actor=self.owner, name="Mgr", email="mgr@example.com", password=PASSWORD, role=User.Role.MANAGER)
        self.business.settings["permissions"]["managerUsers"] = False
        self.business.save()
        self.as_user(manager)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)
        res = self.client.post(
            "/api/users/", {"name": "S", "email": "s2@example.com", "password": PASSWORD, "role": "staff"}, format="json"
        )
        self.assertEqual(res.status_code, 403)


class CrossTenantTests(ApiTestCase):
    """One business must not be able to read, write or point at another's rows."""

    def setUp(self):
        super().setUp()
        self.other, self.other_owner = create_business(
            name="Rivals", owner_name="Rival", owner_email="rival@example.com", owner_password=PASSWORD
        )
        self.their_product = create_product(
            user=self.other_owner, sku="THEIRS", name="Their machine", rentable=True, rent_daily=Decimal("10.00")
        )
        self.their_customer = create_customer(user=self.other_owner, name="Their customer")
        adjust_stock(
            user=self.other_owner, product=self.their_product, quantity=10, reason=StockMovement.Reason.ADJUSTMENT,
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
                "lines": [{"product": str(self.their_product.id), "quantity": 1, "plan": "daily"}],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_another_businesss_stock_cannot_be_corrected(self):
        self.as_user(self.owner)
        res = self.client.post(
            "/api/stock/adjust/",
            {"product": str(self.their_product.id), "quantity": 0, "reason": "adjustment"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.their_product.refresh_from_db()
        self.assertEqual(self.their_product.quantity, 10)


class PasswordResetSessionTests(ApiTestCase):
    """A reset is how a taken-over account is recovered, so it must end every session."""

    def tokens(self, email):
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200)
        return res.data["access"], res.data["refresh"]

    def assert_session_ended(self, access, refresh):
        self.client.credentials()
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_resetting_a_team_members_password_ends_their_sessions(self):
        staff = create_user(actor=self.owner, name="Staff", email="staff@example.com", password=PASSWORD, role=User.Role.STAFF)
        access, refresh = self.tokens("staff@example.com")
        self.as_user(self.owner)
        res = self.client.post(f"/api/users/{staff.id}/password/", {"password": "another-horse-battery"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assert_session_ended(access, refresh)

    def test_the_super_admin_resetting_the_owners_password_ends_their_sessions(self):
        access, refresh = self.tokens("owner@example.com")
        self.as_user(self.superadmin)
        res = self.client.post(
            f"/api/platform/businesses/{self.business.id}/owner-password/",
            {"password": "another-horse-battery"},
            format="json",
        )
        self.assertEqual(res.status_code, 204)
        self.assert_session_ended(access, refresh)


class SessionEndingTests(ApiTestCase):
    def test_disabling_a_user_ends_their_sessions_for_good(self):
        """Even if the account is switched back on, the old tokens stay dead."""
        staff = create_user(actor=self.owner, name="S", email="s@example.com", password=PASSWORD, role=User.Role.STAFF)
        res = self.client.post("/api/auth/login/", {"email": "s@example.com", "password": PASSWORD}, format="json")
        refresh = res.data["refresh"]
        self.as_user(self.owner)
        self.assertEqual(self.client.delete(f"/api/users/{staff.id}/").status_code, 204)
        self.assertEqual(self.client.patch(f"/api/users/{staff.id}/", {"isActive": True}, format="json").status_code, 200)
        self.anonymous()
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code, 401)

    def test_a_refresh_token_for_a_deleted_user_is_refused_not_a_crash(self):
        res = self.client.post("/api/auth/login/", {"email": "owner@example.com", "password": PASSWORD}, format="json")
        refresh = res.data["refresh"]
        User.objects.filter(pk=self.owner.pk).delete()
        self.anonymous()
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code, 401)

    def test_the_platform_resetting_the_owners_password_shows_in_their_activity(self):
        self.as_user(self.superadmin)
        self.client.post(
            f"/api/platform/businesses/{self.business.id}/owner-password/", {"password": "another-horse-battery"}, format="json"
        )
        from apps.accounts.models import Activity

        entry = Activity.objects.get(business=self.business, action="Password reset by the platform")
        self.assertEqual(entry.user, self.superadmin)


class LoginThrottleTests(ApiTestCase):
    def test_the_ip_limit_cannot_be_dodged_with_a_forged_forwarded_for(self):
        """Behind one proxy, only the address that proxy appended counts."""
        codes = [
            self.client.post(
                "/api/auth/login/",
                {"email": f"nobody{i}@example.com", "password": "wrong-password-123"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}, 203.0.113.9",
            ).status_code
            for i in range(7)
        ]
        self.assertEqual(codes[-1], 429)


class SeedDemoTests(ApiTestCase):
    def test_seed_demo_refuses_a_database_with_real_businesses(self):
        from django.core.management import CommandError, call_command

        with self.assertRaises(CommandError):
            call_command("seed_demo")
        self.assertFalse(User.objects.filter(email="admin@example.com").exists())
