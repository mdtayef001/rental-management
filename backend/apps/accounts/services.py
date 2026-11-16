"""Actions that change more than one row, each in one transaction.

Views validate input and decide who may call; services do the work. Keeping them apart
means the rules that protect the data (a business always has an owner, stock and rentals
always agree) live in one place instead of being repeated in every view that touches them.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Business, User, log


@transaction.atomic
def create_business(*, name, owner_name, owner_email, owner_password, industry="", phone="", address="", created_by=None):
    """The super admin's one call: a business and its Owner.

    Both or neither: a business without an owner could never be logged into.
    """
    email = owner_email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise ValidationError({"ownerEmail": "Someone already uses that email address."})

    business = Business.objects.create(name=name.strip(), industry=industry, phone=phone, address=address)
    owner = User.objects.create_user(
        email=email,
        password=owner_password,
        name=owner_name.strip(),
        role=User.Role.OWNER,
        business=business,
        created_by=created_by if created_by and created_by.pk else None,
    )
    return business, owner


@transaction.atomic
def create_user(*, actor, name, email, password, role, rights=None, phone=""):
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
    log(actor, "User added", f"{user.name} · {user.get_role_display()}")
    return user


@transaction.atomic
def set_password(*, actor, user, password):
    user.set_password(password)
    user.save(update_fields=["password"])
    log(actor, "Password changed", user.name)
    return user
