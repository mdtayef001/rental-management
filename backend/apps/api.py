"""Shared serializer and pagination pieces.

The frontend's types use string ids, so every id goes out as a string and is accepted as one.
"""

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class IdField(serializers.CharField):
    """A primary key rendered as a string."""

    def __init__(self, **kwargs):
        kwargs.setdefault("read_only", True)
        super().__init__(**kwargs)

    def to_representation(self, value):
        return None if value is None else str(value)


class StrPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    def to_representation(self, value):
        return str(value.pk)

    def to_internal_value(self, data):
        try:
            data = int(data)
        except (TypeError, ValueError):
            self.fail("incorrect_type", data_type=type(data).__name__)
        return super().to_internal_value(data)


class TenantRelatedField(StrPrimaryKeyRelatedField):
    """Only accepts ids belonging to the requesting user's own business.

    This is the second half of tenant isolation: viewsets filter what goes *out*, this
    filters what can be pointed *at*, so a crafted id can never attach another
    business's product or customer to this business's rental.
    """

    def get_queryset(self):
        return super().get_queryset().filter(business=self.context["request"].user.business)


def tenant_field(model, **kwargs):
    return TenantRelatedField(queryset=model.objects.all(), **kwargs)


class Pagination(PageNumberPagination):
    """Pages of 50 when the caller asks with ?page= (and optionally ?page_size=, up to 200).

    Without ?page= the whole list comes back, which is only used for genuinely small lists
    (branches, categories). A page past the end returns the last page instead of an error, so
    deleting the last row of a page doesn't break the list; the response says which page it is.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        if "page" not in request.query_params:
            return None
        self.request = request
        paginator = self.django_paginator_class(queryset, self.get_page_size(request))
        self.page = paginator.get_page(request.query_params.get("page"))
        return list(self.page)

    def get_paginated_response(self, data):
        return Response({"count": self.page.paginator.count, "page": self.page.number, "results": data})


def exception_handler(exc, context):
    """Turns the few non-DRF errors our services raise into clean API responses.

    A race that trips a unique constraint, or a Django PermissionDenied from deeper in the
    stack, should be a 409 or 403 with a readable message, not an unexplained 500.
    """
    if isinstance(exc, DjangoPermissionDenied):
        return Response({"detail": str(exc) or "You don't have permission to do that."}, status=403)
    if isinstance(exc, IntegrityError):
        return Response({"detail": "That conflicts with something already saved. Reload and try again."}, status=409)
    return drf_exception_handler(exc, context)
