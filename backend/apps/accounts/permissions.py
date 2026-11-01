"""Role rules.

These mirror frontend/src/lib/auth/roles.ts: a route the frontend hides is also refused
here, so hiding a button is never the only thing standing between a user and an action.
"""

from rest_framework.permissions import BasePermission

from .models import User

TEAM = (User.Role.OWNER, User.Role.MANAGER, User.Role.STAFF)
LEADS = (User.Role.OWNER, User.Role.MANAGER)


class IsSuperAdmin(BasePermission):
    """The platform super admin, who creates businesses but owns no data inside one."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_superadmin


class IsTenantMember(BasePermission):
    """A logged-in member of a business that isn't suspended.

    Views narrow this further with `allowed_roles`, `module` and `manager_permission`
    attributes, and with `required_right` for the per-person staff rights.
    """

    message = "You don't have access to this."

    def has_permission(self, request, view):
        user = request.user
        if not (user.is_authenticated and user.business_id and user.role in TEAM):
            return False

        if not user.business.is_open:
            self.message = "This business has been suspended. Please contact support."
            return False

        if user.role not in getattr(view, "allowed_roles", LEADS):
            self.message = "You don't have access to this. Ask the owner if you need it."
            return False

        module = getattr(view, "module", None)
        if module and not user.business.module_on(module):
            self.message = "This feature is switched off in Business settings."
            return False

        right = getattr(view, "required_right", None)
        if right and not getattr(user, right):
            self.message = "You haven't been given permission to do this. Ask the owner."
            return False

        return True


class ManagerNeedsPermission(BasePermission):
    """Writes by a manager need the owner's switch named by `view.manager_permission`.

    Reads are left alone: a manager who can see a list but not change it is a normal
    arrangement, and the view's own `allowed_roles` already decides who sees it at all.
    """

    message = "The owner hasn't given managers permission to change this."

    def has_permission(self, request, view):
        permission = getattr(view, "manager_permission", None)
        if not permission or request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        if request.user.role == User.Role.MANAGER:
            return request.user.business.permission_on(permission)
        return True


class ReadNeedsPermission(BasePermission):
    """Even *reading* needs the owner's switch named by `view.read_permission`.

    `ManagerNeedsPermission` leaves reads alone, which is right for a list a manager should
    see but not change. Reports are the opposite case: the whole point of them is the money,
    so seeing them at all is the thing the owner is granting.
    """

    message = "The owner hasn't given managers access to this."

    def has_permission(self, request, view):
        name = getattr(view, "read_permission", None)
        if not name or request.user.role != User.Role.MANAGER:
            return True
        return request.user.business.permission_on(name)


def creatable_roles(user):
    """Which roles `user` may hand out inside their business.

    Only the Owner makes more owner-level accounts (admins); admins make managers and staff,
    and managers make staff. Nobody can create a role above their own.
    """
    if user.role == User.Role.OWNER:
        if user.is_main_owner:
            return [User.Role.OWNER, User.Role.MANAGER, User.Role.STAFF]
        return [User.Role.MANAGER, User.Role.STAFF]
    if user.role == User.Role.MANAGER:
        return [User.Role.STAFF]
    return []


def can_manage_user(actor, target):
    """Whether `actor` may edit, disable or delete `target`.

    Nobody edits themselves through user management, nobody touches the Owner, and only the
    Owner touches the other owner-level accounts.
    """
    if actor.pk == target.pk or target.is_main_owner:
        return False
    if target.role == User.Role.OWNER:
        return actor.is_main_owner
    if actor.role == User.Role.MANAGER:
        return target.role == User.Role.STAFF
    return actor.role == User.Role.OWNER
