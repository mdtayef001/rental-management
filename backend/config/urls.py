from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.catalog.urls")),
    path("api/", include("apps.rentals.urls")),
    path("api/", include("apps.purchasing.urls")),
    path("api/", include("apps.reports.urls")),
]
