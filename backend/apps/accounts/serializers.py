"""Serializers for tenancy, identity and the super admin's platform screens."""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.api import IdField

from .models import Activity, Branch, Business, User
from .permissions import creatable_roles

# The per-person rights an owner or manager can give a staff member.
RIGHTS = ("can_rent", "can_take_returns", "can_sell", "can_add_stock", "can_handle_deposits")


def check_password_strength(password, user=None):
    """Django's validators, reported as a field error the frontend can show."""
    try:
        validate_password(password, user)
    except DjangoValidationError as err:
        raise serializers.ValidationError(list(err.messages)) from err
    return password


class LoginSerializer(TokenObtainPairSerializer):
    """Adds the claims proxy.ts needs to route a request without asking Django first."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["tenant_id"] = str(user.business_id) if user.business_id else None
        # So the proxy can hide a route a staff member has no right to, before it renders.
        token["can_rent"] = user.may_rent
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        # A suspended business can't be logged into at all, and the message says why without
        # revealing anything about other accounts.
        if user.business_id and user.business.suspended:
            raise serializers.ValidationError("This business has been suspended. Please contact support.")
        return data


class BranchSerializer(serializers.ModelSerializer):
    id = IdField()

    class Meta:
        model = Branch
        fields = ["id", "name", "address", "phone"]


class UserSerializer(serializers.ModelSerializer):
    """A team member as the frontend's Users screen shows them."""

    id = IdField()
    branch_ids = serializers.SerializerMethodField()
    is_main_owner = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "name", "email", "phone", "role", "is_active", "is_main_owner",
            "branch_ids", "date_joined", "last_login", *RIGHTS,
        ]
        read_only_fields = ["date_joined", "last_login"]

    def get_branch_ids(self, user):
        # Prefetched by the viewset, so this costs no extra query per row.
        return [str(b.id) for b in user.branches.all()]


class UserCreateSerializer(serializers.Serializer):
    """Creating a team member. The role is checked against what the actor may hand out."""

    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    password = serializers.CharField(write_only=True)
    role = serializers.ChoiceField(choices=User.Role.choices)
    branch_ids = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    can_rent = serializers.BooleanField(default=True)
    can_take_returns = serializers.BooleanField(default=True)
    can_sell = serializers.BooleanField(default=False)
    can_add_stock = serializers.BooleanField(default=False)
    can_handle_deposits = serializers.BooleanField(default=False)

    def validate_role(self, role):
        allowed = creatable_roles(self.context["request"].user)
        if role not in allowed:
            raise serializers.ValidationError("You can't give someone that role.")
        return role

    def validate_password(self, password):
        return check_password_strength(password)

    def validate_branch_ids(self, ids):
        return [i for i in ids if str(i).isdigit()]


class UserUpdateSerializer(serializers.ModelSerializer):
    """Editing a team member. Email and role changes are handled here too, but the viewset
    decides whether this actor may touch this user at all."""

    branch_ids = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = User
        fields = ["name", "phone", "role", "is_active", "branch_ids", *RIGHTS]

    def validate_role(self, role):
        allowed = creatable_roles(self.context["request"].user)
        if role not in allowed:
            raise serializers.ValidationError("You can't give someone that role.")
        return role

    def update(self, user, data):
        branch_ids = data.pop("branch_ids", None)
        user = super().update(user, data)
        if branch_ids is not None:
            user.branches.set(Branch.objects.filter(business=user.business, id__in=[i for i in branch_ids if str(i).isdigit()]))
        return user


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True)

    def validate_password(self, password):
        return check_password_strength(password)


class BusinessSerializer(serializers.ModelSerializer):
    id = IdField()
    status = serializers.CharField(read_only=True)
    branches = BranchSerializer(many=True, read_only=True)

    class Meta:
        model = Business
        fields = ["id", "name", "industry", "phone", "address", "status", "suspended", "suspended_reason", "settings", "branches", "created_at"]
        read_only_fields = ["suspended", "suspended_reason", "created_at"]


class BusinessSettingsSerializer(serializers.ModelSerializer):
    """What the owner may change about their own business."""

    class Meta:
        model = Business
        fields = ["name", "industry", "phone", "address", "settings"]

    def validate_settings(self, incoming):
        """Merge one level deep, so sending only `{"receiptNote": "..."}` doesn't wipe the
        modules and permissions the owner never mentioned."""
        if not isinstance(incoming, dict):
            raise serializers.ValidationError("Settings must be an object.")
        merged = dict(self.instance.settings)
        for key, value in incoming.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = {**merged[key], **value}
            else:
                merged[key] = value
        return merged


class PlatformBusinessSerializer(serializers.ModelSerializer):
    """The super admin's list: a business with its owner and a few counts."""

    id = IdField()
    status = serializers.CharField(read_only=True)
    owner_name = serializers.SerializerMethodField()
    owner_email = serializers.SerializerMethodField()
    user_count = serializers.IntegerField(read_only=True)
    product_count = serializers.IntegerField(read_only=True)
    open_rental_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Business
        fields = [
            "id", "name", "industry", "phone", "address", "status", "suspended", "suspended_reason",
            "owner_name", "owner_email", "user_count", "product_count", "open_rental_count", "created_at",
        ]

    def _owner(self, business):
        # The viewset prefetches the owner, so this adds no query per row.
        owners = [u for u in business.users.all() if u.role == User.Role.OWNER]
        return owners[0] if owners else None

    def get_owner_name(self, business):
        owner = self._owner(business)
        return owner.name if owner else ""

    def get_owner_email(self, business):
        owner = self._owner(business)
        return owner.email if owner else ""


class BusinessCreateSerializer(serializers.Serializer):
    """The super admin creating a business together with its Owner."""

    name = serializers.CharField(max_length=200)
    industry = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    address = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    branch_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="Main branch")
    owner_name = serializers.CharField(max_length=150)
    owner_email = serializers.EmailField()
    owner_password = serializers.CharField(write_only=True)

    def validate_owner_password(self, password):
        return check_password_strength(password)


class SuspendSerializer(serializers.Serializer):
    suspended = serializers.BooleanField()
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class DeleteBusinessSerializer(serializers.Serializer):
    """Deleting a business takes everything in it, so the name has to be typed back.

    Note the field is `confirm_name` here: the camelCase parser turns the frontend's
    `confirmName` into snake_case before a serializer or view ever sees it.
    """

    confirm_name = serializers.CharField(max_length=200)

    def validate_confirm_name(self, value):
        if value.strip() != self.context["business"].name:
            raise serializers.ValidationError("Type the business name exactly to confirm.")
        return value


class ActivitySerializer(serializers.ModelSerializer):
    id = IdField()
    user_name = serializers.CharField(source="user.name", read_only=True, default="")

    class Meta:
        model = Activity
        fields = ["id", "at", "action", "detail", "user_name"]
