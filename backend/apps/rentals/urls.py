from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("rentals", views.RentalViewSet, basename="rental")
router.register("returns", views.RentalReturnViewSet, basename="rental-return")

urlpatterns = [
    path("receipts/<str:token>/", views.PublicReceiptView.as_view(), name="public-receipt"),
    *router.urls,
]
