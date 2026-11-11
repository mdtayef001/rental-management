from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("rentals", views.RentalViewSet, basename="rental")
router.register("returns", views.RentalReturnViewSet, basename="rental-return")

urlpatterns = [
    path("receipts/<str:token>/", views.PublicReceiptView.as_view(), name="public-receipt"),
    path("receipts/<str:token>/logo/", views.PublicReceiptLogoView.as_view(), name="public-receipt-logo"),
    path("bills/", views.BillListView.as_view(), name="bill-list"),
    path("bills/<int:customer_id>/", views.BillDetailView.as_view(), name="bill-detail"),
    path("bills/<int:customer_id>/pdf/", views.BillPdfView.as_view(), name="bill-pdf"),
    path("bills/<int:customer_id>/payment/", views.BillPaymentView.as_view(), name="bill-payment"),
    *router.urls,
]
