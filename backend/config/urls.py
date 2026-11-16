from django.urls import include, path

urlpatterns = [
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.catalog.urls")),
    path("api/", include("apps.rentals.urls")),
    path("api/", include("apps.reports.urls")),
]
