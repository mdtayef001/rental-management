"""The reports API: four JSON endpoints and one CSV download.

Who may read these is the whole of the access control here. Reports show the money, so they
are owner-only unless the owner has switched "See profit and reports" on for managers —
the same rule the frontend uses to hide the link, enforced again here because hiding a link
is not a security control.
"""

import csv

from django.http import StreamingHttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import LEADS, IsTenantMember, ReadNeedsPermission

from . import services


class ReportView(APIView):
    """Shared gate: a lead, in a business that isn't suspended, allowed to see the money."""

    permission_classes = [IsAuthenticated, IsTenantMember, ReadNeedsPermission]
    allowed_roles = LEADS
    read_permission = "managerProfit"

    @property
    def business(self):
        return self.request.user.business

    @property
    def range(self):
        return services.parse_range(self.request.query_params)


class SummaryView(ReportView):
    def get(self, request):
        return Response(services.summary(self.business, self.range))


class RevenueView(ReportView):
    def get(self, request):
        rng = self.range
        group, rows = services.revenue_series(self.business, rng, services.group_by(request.query_params))
        return Response({**rng.as_json(), "group": group, "results": rows})


class ProductsView(ReportView):
    def get(self, request):
        rng = self.range
        return Response({**rng.as_json(), "results": services.top_products(self.business, rng, self._limit())})

    def _limit(self):
        asked = self.request.query_params.get("limit", "")
        return min(int(asked), services.MAX_TOP_N) if asked.isdigit() and int(asked) > 0 else services.TOP_N


class CustomersView(ProductsView):
    def get(self, request):
        rng = self.range
        return Response({**rng.as_json(), "results": services.top_customers(self.business, rng, self._limit())})


class DebtorsView(ProductsView):
    def get(self, request):
        return Response({"results": services.debtors(self.business, self._limit())})


class PdfView(ReportView):
    """The report as a PDF: the sheet the owner prints or sends to their accountant."""

    def get(self, request):
        from django.http import HttpResponse

        from apps.sheet_pdf import logo_of

        from . import report_pdf

        rng = self.range
        report = services.overview(self.business, rng, services.group_by(request.query_params))
        response = HttpResponse(report_pdf.render(report, logo=logo_of(self.business)), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="report_{rng.slug()}.pdf"'
        response["Cache-Control"] = "no-store"
        return response


class ExportView(ReportView):
    """One report as a CSV file.

    Streamed rather than assembled: a year of returns is tens of thousands of rows, and the
    owner's browser should start saving the file immediately instead of waiting for Django
    to hold all of it in memory.
    """

    def get(self, request):
        rng = self.range
        export = services.csv_rows(
            self.business, (request.query_params.get("report") or "").strip(), rng, services.group_by(request.query_params)
        )
        if export is None:
            return Response({"detail": "Unknown report.", "reports": sorted(services.EXPORTS)}, status=400)

        filename, header, rows = export
        writer = csv.writer(Echo())
        response = StreamingHttpResponse(
            (writer.writerow(line) for line in _lines(self.business, rng, header, rows)),
            content_type="text/csv; charset=utf-8",
        )
        # The quotes matter: without them a filename containing a space or comma is cut off.
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        # Nothing about a tenant's money should sit in a shared cache.
        response["Cache-Control"] = "no-store"
        return response


def _lines(business, rng, header, rows):
    """The file: a line saying what it is, then the header, then the data."""
    yield [f"{business.name} — {rng.start.date().isoformat()} to {rng.last_day.isoformat()}"]
    yield header
    for row in rows:
        yield [safe(value) for value in row]


def safe(value):
    """A cell a spreadsheet will treat as text, never as a formula.

    Excel and Sheets run a cell starting `=`, `+`, `-` or `@` as a formula, so a customer
    who names themselves `=HYPERLINK(...)` would have that formula execute on the owner's
    machine when they open the export. Prefixing an apostrophe is the standard defence: the
    cell reads the same and does nothing.
    """
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{value}"
    return "" if value is None else value


class Echo:
    """A file-like object that hands each written line straight back.

    `csv.writer` wants somewhere to write; a streaming response wants each row returned as
    it is produced. This is the one-line adapter between them.
    """

    def write(self, value):
        return value
