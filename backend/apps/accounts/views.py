"""Auth, team management, business settings and the super admin's platform API."""

from django.contrib.auth import update_session_auth_hash  # noqa: F401  (kept for admin flows)
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.api import Pagination

from . import services
from .models import Activity, Branch, Business, User, log
from .permissions import LEADS, TEAM, IsSuperAdmin, IsTenantMember, ManagerNeedsPermission, can_manage_user, creatable_roles
from .serializers import (
    ActivitySerializer,
    BranchSerializer,
    BusinessCreateSerializer,
    BusinessSerializer,
    BusinessSettingsSerializer,
    DeleteBusinessSerializer,
    LoginSerializer,
    PasswordSerializer,
    PlatformBusinessSerializer,
    SuspendSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)


class LoginView(TokenObtainPairView):
    """Email and password for an access + refresh token pair.

    Throttled by IP: five tries a minute, so a stolen email list can't be run against the
    login form. The error never says whether the email exists.
    """

    serializer_class = LoginSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(APIView):
    """Blacklists the refresh token, so it stops working even if someone copied it."""

    def post(self, request):
        token = request.data.get("refresh")
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                # Already expired or already blacklisted: the user is logged out either way.
                pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Who am I, and what business am I in.

    The frontend's data access layer calls this on every page request, so disabling an
    account, changing its role or suspending a business takes effect at once — a still-valid
    token doesn't keep anyone in.
    """

    def get(self, request):
        user = request.user
        business = user.business
        if business and business.suspended and not user.is_superadmin:
            return Response({"detail": "This business has been suspended."}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            {
                "user": {
                    **UserSerializer(user).data,
                    "creatableRoles": creatable_roles(user),
                },
                "business": BusinessSerializer(business).data if business else None,
            }
        )


class TenantView(APIView):
    """Base for the single-object tenant endpoints below."""

    permission_classes = [IsAuthenticated, IsTenantMember]
    allowed_roles = LEADS


class BusinessSettingsView(TenantView):
    """The owner reading and changing their own business."""

    allowed_roles = (User.Role.OWNER,)

    def get(self, request):
        return Response(BusinessSerializer(request.user.business).data)

    def patch(self, request):
        serializer = BusinessSettingsSerializer(request.user.business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log(request.user, "Settings changed", ", ".join(serializer.validated_data))
        return Response(BusinessSerializer(request.user.business).data)


class BranchViewSet(viewsets.ModelViewSet):
    """Branches of the caller's own business. Small list, so it isn't paginated."""

    permission_classes = [IsAuthenticated, IsTenantMember, ManagerNeedsPermission]
    serializer_class = BranchSerializer
    pagination_class = None
    allowed_roles = TEAM
    manager_permission = "managerBranches"

    def get_queryset(self):
        return Branch.objects.filter(business=self.request.user.business)

    def check_permissions(self, request):
        super().check_permissions(request)
        # Staff may read the list (they need branch names on screen) but never change it.
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.user.role == User.Role.STAFF:
            raise PermissionDenied("Only the owner or a manager can change branches.")

    def perform_create(self, serializer):
        services.add_branch(actor=self.request.user, **serializer.validated_data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch = services.add_branch(actor=request.user, **serializer.validated_data)
        return Response(BranchSerializer(branch).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        branch = serializer.save()
        log(self.request.user, "Branch changed", branch.name)

    def perform_destroy(self, branch):
        services.delete_branch(actor=self.request.user, branch=branch)


class UserViewSet(viewsets.ModelViewSet):
    """The team inside one business.

    Owners and managers see and manage their own people; who may touch whom is decided by
    `can_manage_user`, not by the client.
    """

    permission_classes = [IsAuthenticated, IsTenantMember, ManagerNeedsPermission]
    pagination_class = Pagination
    allowed_roles = LEADS
    manager_permission = "managerUsers"

    def get_queryset(self):
        qs = (
            User.objects.filter(business=self.request.user.business)
            .exclude(role=User.Role.SUPERADMIN)
            .prefetch_related("branches")
        )
        # A manager has no business seeing or editing owner-level accounts.
        if self.request.user.role == User.Role.MANAGER:
            qs = qs.exclude(role=User.Role.OWNER)
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(email__icontains=search))
        role = self.request.query_params.get("role", "").strip()
        if role in User.Role.values:
            qs = qs.filter(role=role)
        return qs

    def get_serializer_class(self):
        return UserUpdateSerializer if self.action in ("update", "partial_update") else UserSerializer

    def target(self):
        """The user being changed, refused unless this actor may manage them."""
        user = self.get_object()
        if not can_manage_user(self.request.user, user):
            raise PermissionDenied("You can't change this account.")
        return user

    def create(self, request, *args, **kwargs):
        serializer = UserCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        rights = {k: data.pop(k) for k in ("can_rent", "can_take_returns", "can_sell", "can_add_stock", "can_handle_deposits")}
        user = services.create_user(
            actor=request.user,
            name=data["name"],
            email=data["email"],
            phone=data["phone"],
            password=data["password"],
            role=data["role"],
            branch_ids=data["branch_ids"],
            rights=rights,
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        user = self.target()
        serializer = UserUpdateSerializer(user, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log(request.user, "User changed", user.name)
        return Response(UserSerializer(user).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Disables the account rather than deleting it, so the rentals and returns they
        handled keep their name against them."""
        user = self.target()
        user.is_active = False
        user.save(update_fields=["is_active"])
        log(request.user, "User disabled", user.name)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def password(self, request, pk=None):
        user = self.target()
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.set_password(actor=request.user, user=user, password=serializer.validated_data["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActivityViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The audit log. Owners see everything; managers need the owner's permission."""

    permission_classes = [IsAuthenticated, IsTenantMember]
    serializer_class = ActivitySerializer
    pagination_class = Pagination
    allowed_roles = LEADS

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.user.role == User.Role.MANAGER and not request.user.business.permission_on("managerActivity"):
            raise PermissionDenied("The owner hasn't given managers access to the activity log.")

    def get_queryset(self):
        qs = Activity.objects.filter(business=self.request.user.business).select_related("user")
        user_id = self.request.query_params.get("user", "")
        if user_id.isdigit():
            qs = qs.filter(user_id=int(user_id))
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(action__icontains=search) | Q(detail__icontains=search))
        return qs

    @action(detail=False)
    def people(self, request):
        """Everyone who appears in the log, for the filter dropdown."""
        rows = (
            Activity.objects.filter(business=request.user.business, user__isnull=False)
            .values("user_id", "user__name")
            .distinct()
            .order_by("user__name")
        )
        return Response([{"id": str(r["user_id"]), "name": r["user__name"]} for r in rows])


# ---------- Platform (super admin) ----------


class PlatformBusinessViewSet(viewsets.ModelViewSet):
    """The super admin creating and overseeing businesses.

    The super admin can create, suspend and delete a business, and reset its owner's
    password — but has no endpoint that reads a tenant's rentals, customers or money.
    """

    permission_classes = [IsAuthenticated, IsSuperAdmin]
    serializer_class = PlatformBusinessSerializer
    pagination_class = Pagination

    def get_queryset(self):
        qs = Business.objects.prefetch_related(
            Prefetch("users", queryset=User.objects.filter(role=User.Role.OWNER).order_by("date_joined", "id"))
        ).annotate(
            user_count=Count("users", distinct=True),
        )
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(users__email__icontains=search)).distinct()
        state = self.request.query_params.get("status", "")
        if state == "suspended":
            qs = qs.filter(suspended=True)
        elif state == "active":
            qs = qs.filter(suspended=False)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def create(self, request, *args, **kwargs):
        serializer = BusinessCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        business, _branch, owner = services.create_business(**serializer.validated_data, created_by=request.user)
        return Response(
            {**PlatformBusinessSerializer(business).data, "ownerName": owner.name, "ownerEmail": owner.email},
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        business = self.get_object()
        serializer = BusinessSettingsSerializer(business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(PlatformBusinessSerializer(business).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        """Switches a business off or back on. Suspended, nobody in it can log in."""
        business = self.get_object()
        serializer = SuspendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        business.suspended = serializer.validated_data["suspended"]
        business.suspended_reason = serializer.validated_data["reason"] if business.suspended else ""
        business.save(update_fields=["suspended", "suspended_reason"])
        return Response(PlatformBusinessSerializer(business).data)

    @action(detail=True, methods=["post"], url_path="owner-password")
    def owner_password(self, request, pk=None):
        """Resets the Owner's password, for when they're locked out."""
        business = self.get_object()
        owner = business.main_owner()
        if not owner:
            raise ValidationError("This business has no owner account.")
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner.set_password(serializer.validated_data["password"])
        owner.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        """Deletes a business and everything in it. Needs the name typed back, so it can't
        happen by a mis-click on the wrong row."""
        business = self.get_object()
        serializer = DeleteBusinessSerializer(data=request.data, context={"business": business})
        serializer.is_valid(raise_exception=True)
        business.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
