from django.urls import path

from . import views

urlpatterns = [
    path("reports/summary/", views.SummaryView.as_view(), name="report-summary"),
    path("reports/revenue/", views.RevenueView.as_view(), name="report-revenue"),
    path("reports/products/", views.ProductsView.as_view(), name="report-products"),
    path("reports/customers/", views.CustomersView.as_view(), name="report-customers"),
    path("reports/export/", views.ExportView.as_view(), name="report-export"),
]
