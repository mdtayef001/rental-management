"""Tenancy and identity.

A Business is one tenant: every other row in the system carries a `business` foreign key.
There is no sign-up and no subscription — the platform super admin creates a business
together with its owner, and the owner creates everyone else.
"""

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


def default_settings():
    """A new business's settings. Kept as JSON so the owner can change them without a migration.

    Keys are camelCase because the frontend reads this object as-is (see JSON_UNDERSCOREIZE
    in config/settings.py).
    """
    return {
        "currency": "BDT",
        # Features the owner can switch off for their business.
        "modules": {"rentals": True},
        # What managers may do. Owners can always do everything.
        "permissions": {
            "managerUsers": True,
            "managerProducts": True,
            "managerCustomers": True,
            "managerBranches": False,
            "managerActivity": False,
            "managerProfit": False,
            "staffCreateProducts": False,
        },
        # Rental defaults, so staff don't retype them on every rental.
        "rentals": {
            # Default billing plan for a new rental line.
            "defaultPlan": "daily",
            # Charged per day for every day an item is late, as a share of the daily rate.
            # 1.0 means a late day costs the same as a rented day; 1.5 adds a 50% penalty.
            "lateFeeMultiplier": 1.0,
            # Rentals with no agreed return date are allowed.
            "allowOpenEnded": True,
        },
        # The owner's own line at the bottom of every receipt, e.g. the return policy.
        "receiptNote": "",
        # The low-stock alert new products start with.
        "lowStockAlert": 5,
    }


class Business(models.Model):
    """One tenant. Created by the platform super admin; it has no billing state."""

    name = models.CharField(max_length=200)
    industry = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    address = models.CharField(max_length=300, blank=True)
    # Set by the super admin. Blocks everyone in the business, owner included.
    suspended = models.BooleanField(default=False)
    suspended_reason = models.CharField(max_length=300, blank=True)
    settings = models.JSONField(default=default_settings)
    # Changes whenever the logo does, so browsers can cache the image for good and still
    # pick a new one up at once. Blank means there is no logo.
    logo_version = models.CharField(max_length=16, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "businesses"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    def main_owner(self):
        """The Owner: the business's first owner account. Any later ones are admins, with the
        same access except over the Owner and over each other."""
        return self.users.filter(role=User.Role.OWNER).order_by("date_joined", "id").first()

    @property
    def status(self):
        """active | suspended. Nothing else: there is no trial and no unpaid state."""
        return "suspended" if self.suspended else "active"

    @property
    def is_open(self):
        return not self.suspended

    def module_on(self, module):
        return bool(self.settings.get("modules", {}).get(module))

    def permission_on(self, permission):
        return bool(self.settings.get("permissions", {}).get(permission))

    def rental_setting(self, key, default=None):
        return self.settings.get("rentals", {}).get(key, default)

    @property
    def low_stock_alert(self):
        return self.settings.get("lowStockAlert", 5)

    @property
    def receipt_note(self):
        return self.settings.get("receiptNote", "")


class BusinessLogo(models.Model):
    """The business's own logo, printed at the top of receipts, bills and reports.

    Kept in its own table rather than on Business: the business row is read on every
    request, and an image has no place riding along with it. This row is only read when a
    page or a PDF actually draws the logo.
    """

    #: Bytes, after the browser has already scaled the picture down.
    MAX_BYTES = 400 * 1024
    TYPES = {"image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}

    business = models.OneToOneField(Business, on_delete=models.CASCADE, related_name="logo")
    content_type = models.CharField(max_length=20)
    data = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Logo of {self.business_id}"


class Branch(models.Model):
    """Where stock sits and rentals go out from.

    Every business gets one on creation. Most clients will only ever have that one, and the
    frontend hides the branch picker while there is a single branch — but stock, rentals and
    staff are already keyed to it, so opening a second shop needs no migration.
    """

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=150)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "branches"
        # Creation order, so the branch the business started with stays first and is the
        # default in every form.
        ordering = ["id"]

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required.")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        """`manage.py createsuperuser` makes the platform super admin."""
        extra["role"] = User.Role.SUPERADMIN
        extra["business"] = None
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    """Login is by email. There is no sign-up: the super admin creates businesses with their
    owner, and owners and managers create the rest."""

    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Super admin"
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"
        STAFF = "staff", "Staff"

    username = None
    first_name = None
    last_name = None
    name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=40, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    # Null only for the platform super admin.
    business = models.ForeignKey(Business, null=True, blank=True, on_delete=models.CASCADE, related_name="users")
    # Branches this user works at. Empty for owners, who see every branch.
    branches = models.ManyToManyField(Branch, blank=True, related_name="users")
    created_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # Per-person rights for staff, set by the owner or a manager. Owners and managers can
    # always do all of them.
    can_rent = models.BooleanField(default=True)
    can_take_returns = models.BooleanField(default=True)
    can_add_stock = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["business", "role"])]

    def __str__(self):
        return f"{self.name} <{self.email}>"

    @property
    def is_superadmin(self):
        return self.role == self.Role.SUPERADMIN

    @property
    def is_main_owner(self):
        """True for the business's first owner account, who can't be edited or removed by
        the other owner-level accounts."""
        if self.role != self.Role.OWNER or not self.business_id:
            return False
        main = self.business.main_owner()
        return main is not None and main.pk == self.pk

    # Rights: a non-staff member of the team can always do these.
    def _right(self, field):
        return self.role != self.Role.STAFF or getattr(self, field)

    @property
    def may_rent(self):
        return self._right("can_rent")

    @property
    def may_take_returns(self):
        return self._right("can_take_returns")

    @property
    def may_add_stock(self):
        return self._right("can_add_stock")

    def branch_ids(self):
        """The branches this user may act in. None means every branch (owners and managers)."""
        if self.role in (self.Role.OWNER, self.Role.MANAGER):
            return None
        return set(self.branches.values_list("id", flat=True))

    def save(self, *args, **kwargs):
        # Super admins get Django admin access; everyone else uses the app only.
        self.is_staff = self.is_superuser = self.role == self.Role.SUPERADMIN
        super().save(*args, **kwargs)


class TenantModel(models.Model):
    """Base for every row that belongs to one business.

    Having the foreign key in one place is what lets a single base viewset scope every
    queryset to `request.user.business` instead of trusting each view to remember.
    """

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


class Activity(TenantModel):
    """Audit log: who did what, when. Written by the service functions, never by views."""

    at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=100)
    detail = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-at"]
        verbose_name_plural = "activity"
        indexes = [models.Index(fields=["business", "-at"])]

    def __str__(self):
        return f"{self.action} · {self.detail}"


def log(user, action, detail=""):
    """Record one action against the acting user's business. Safe to call inside a transaction."""
    if not user or not getattr(user, "business_id", None):
        return None
    return Activity.objects.create(business_id=user.business_id, user=user, action=action, detail=detail[:500])
