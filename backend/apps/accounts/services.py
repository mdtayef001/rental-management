"""Actions that change more than one row, each in one transaction.

Views validate input and decide who may call; services do the work. Keeping them apart
means the rules that protect the data (a business always has a branch, stock and rentals
always agree) live in one place instead of being repeated in every view that touches them.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Branch, Business, User, log


@transaction.atomic
def create_business(*, name, owner_name, owner_email, owner_password, industry="", phone="", address="", branch_name="Main branch", created_by=None):
    """The super admin's one call: a business, its first branch, and its Owner.

    All three or none. A business without an owner could never be logged into, and one
    without a branch has nowhere to put stock, so neither is allowed to exist.
    """
    email = owner_email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise ValidationError({"ownerEmail": "Someone already uses that email address."})

    business = Business.objects.create(name=name.strip(), industry=industry, phone=phone, address=address)
    branch = Branch.objects.create(business=business, name=(branch_name or "Main branch").strip(), address=address, phone=phone)
    owner = User.objects.create_user(
        email=email,
        password=owner_password,
        name=owner_name.strip(),
        role=User.Role.OWNER,
        business=business,
        created_by=created_by if created_by and created_by.pk else None,
    )
    return business, branch, owner


@transaction.atomic
def create_user(*, actor, name, email, password, role, branch_ids=(), rights=None, phone=""):
    """An owner or manager adding someone to their own business."""
    email = email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise ValidationError({"email": "Someone already uses that email address."})

    user = User.objects.create_user(
        email=email,
        password=password,
        name=name.strip(),
        phone=phone,
        role=role,
        business=actor.business,
        created_by=actor,
        **(rights or {}),
    )
    if branch_ids:
        # Only branches of the actor's own business, so a crafted id can't attach someone
        # to another tenant's branch.
        user.branches.set(Branch.objects.filter(business=actor.business, id__in=branch_ids))
    log(actor, "User added", f"{user.name} · {user.get_role_display()}")
    return user


@transaction.atomic
def set_password(*, actor, user, password):
    user.set_password(password)
    user.save(update_fields=["password"])
    log(actor, "Password changed", user.name)
    return user


@transaction.atomic
def add_branch(*, actor, name, address="", phone=""):
    branch = Branch.objects.create(business=actor.business, name=name.strip(), address=address, phone=phone)
    log(actor, "Branch added", branch.name)
    return branch


@transaction.atomic
def delete_branch(*, actor, branch):
    """Refused while anything still points at the branch, so history is never orphaned."""
    from apps.catalog.models import StockLevel
    from apps.rentals.models import Rental

    if Branch.objects.filter(business=actor.business).count() <= 1:
        raise ValidationError("A business needs at least one branch.")
    if Rental.objects.filter(branch=branch, status__in=Rental.OPEN).exists():
        raise ValidationError("This branch has rentals still out. Take them back first.")
    if StockLevel.objects.filter(branch=branch, quantity__gt=0).exists():
        raise ValidationError("This branch still holds stock. Move or write it off first.")
    name = branch.name
    branch.delete()
    log(actor, "Branch deleted", name)
