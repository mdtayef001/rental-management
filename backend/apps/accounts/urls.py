from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="user")
router.register("activity", views.ActivityViewSet, basename="activity")
router.register("platform/businesses", views.PlatformBusinessViewSet, basename="platform-business")

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/refresh/", views.RefreshView.as_view(), name="token-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/me/", views.MeView.as_view(), name="me"),
    path("business/", views.BusinessSettingsView.as_view(), name="business"),
    path("business/logo/", views.BusinessLogoView.as_view(), name="business-logo"),
    *router.urls,
]
