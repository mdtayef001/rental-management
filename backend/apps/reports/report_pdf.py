"""The owner's report as a PDF: one sheet to print, file, or send to an accountant.

Drawn from `services.overview`, the same figures the Reports screen shows, on the same
sheet the browser prints (`apps/sheet_pdf.py`). It mirrors `ReportDocument` in the
frontend's `components/report.tsx` block for block, so the downloaded file is the printed
page.
"""

from datetime import date

from reportlab.platypus import CondPageBreak, KeepTogether, Spacer, Table, TableStyle

from apps.sheet_pdf import LINE, THIN, TINT, Sheet, cash, day  # noqa: F401

GROUP_LABEL = {"day": "Day", "week": "Week starting", "month": "Month"}


def range_label(first, last):
    """The period, written the way the screen's heading writes it."""
    if first == last:
        return f"{first.day} {first:%B %Y}"
    if first.year != last.year:
        return f"{first.day} {first:%b %Y} – {last.day} {last:%b %Y}"
    if first.month == last.month:
        return f"{first.day}–{last.day} {last:%B %Y}"
    return f"{first.day} {first:%b} – {last.day} {last:%b %Y}"


def period(text, group):
    """A bucket's first day, written the way the screen writes it."""
    value = date.fromisoformat(text)
    if group == "month":
        return value.strftime("%b %Y")
    return f"{value.day} {value.strftime('%b')}"


def render(report, logo=None):
    """The report as PDF bytes. `logo` is the business's logo as PNG or JPEG bytes, if any."""
    business = report["business"]
    currency = business["currency"]
    s = report["summary"]
    group = report["group"]

    def money(value):
        return cash(value, currency)

    try:
        label = range_label(date.fromisoformat(s["from"]), date.fromisoformat(s["to"]))
    except (KeyError, ValueError):
        label = report["label"]

    sheet = Sheet(title=f"Report {label}", author=business["name"])
    p = sheet.p

    sheet.header(
        business,
        logo,
        "Business report",
        [(label, "semi", False), (f"Printed {day(report['generated_at'])}", "regular", False)],
    )
    sheet.gap(15)

    # ---- The four figures an owner asks for first, ruled as one table ----
    figures = [
        ("Earned", money(s["revenue"]), None),
        ("Money received", money(s["collected"] - s["refunded"]), None),
        ("Owed by customers", money(s["outstanding"]), None),
        ("Out on rent", f"{s['unitsOut']:,} units", f"{s['openRentals']:,} rentals, {s['overdue']:,} overdue"),
    ]
    cells = []
    for name, value, note in figures:
        cell = [sheet.caption(name), Spacer(1, 1.5), p(value, size=13.5 / 10.5, weight="bold")]
        if note:
            cell.append(p(note, size=0.9))
        cells.append(cell)
    sheet.add(sheet.boxes(cells, (0.25, 0.25, 0.25, 0.25)))
    sheet.gap(15)

    # ---- Where the money came from, and what moved ----
    half = (sheet.width - 15) / 2
    earned = [("Rent", money(s["rent"]))]
    if s["lateFees"]:
        earned.append(("Late fees", money(s["lateFees"])))
    if s["damageFees"]:
        earned.append(("Damage and loss", money(s["damageFees"])))
    if s["discounts"]:
        earned.append(("Discounts given", money(-s["discounts"])))
    left = [sheet.caption("Earned"), Spacer(1, 3), sheet.sums(earned, total=("Total earned", money(s["revenue"])), width=half)]
    if s["advancesHeld"] > 0:
        left += [Spacer(1, 6), sheet.sums([("Advances held, not yet earned", money(s["advancesHeld"]))], width=half)]

    moved = [
        ("Rentals started", s["rentals"]),
        ("Units sent out", s["unitsRented"]),
        ("Units returned", s["unitsReturned"]),
        ("Returns taken", s["returns"]),
        ("New customers", s["newCustomers"]),
    ]
    if s["unitsDamaged"]:
        moved.append(("Returned damaged", s["unitsDamaged"]))
    if s["unitsLost"]:
        moved.append(("Never returned", s["unitsLost"]))
    right = [sheet.caption("Activity"), Spacer(1, 3), sheet.sums([(name, f"{value:,}") for name, value in moved], width=half)]
    sheet.add(KeepTogether([sheet.side_by_side(left, right, half, half)]))

    def listing(title, head, rows, widths, empty, figures_from, total=None):
        """A titled table. Short ones stay in one piece; a long one may run over the page."""
        block = [Spacer(1, 18), sheet.caption(title), Spacer(1, 3)]
        if not rows:
            sheet.add(KeepTogether([*block, sheet.note(empty)]))
            return
        table = sheet.table(head, rows, widths, figures_from, total=(total, None) if total else None)
        if len(rows) <= 12:
            sheet.add(KeepTogether([*block, table]))
        else:
            sheet.add(CondPageBreak(90), *block, table)

    # ---- Earned over time: one row for each thing that came back ----
    earned_rows, units = [], 0
    for row in report["revenue"]:
        for index, line in enumerate(row["details"]):
            units += line["units"]
            earned_rows.append(
                [
                    p(period(row["period"], group), weight="semi") if index == 0 else "",
                    line["customer"],
                    line["product"],
                    p(line["sku"] or line["barcode"] or "—", mono=True, size=0.92),
                    f"{line['units']:,}",
                    money(line["amount"]),
                ]
            )
        if row["discounts"]:
            earned_rows.append(["", "Discount", "", "", "", money(-row["discounts"])])
    listing(
        f"Earned per {group}",
        [GROUP_LABEL[group], "Customer", "Product", "SKU / barcode", "Units", "Earned"],
        earned_rows,
        (0.13, 0.22, 0.23, 0.17, 0.09, 0.16),
        "Nothing was earned in this period.",
        figures_from=4,
        total=["Total", "", "", "", f"{units:,}", money(sum(row["revenue"] for row in report["revenue"]))],
    )

    listing(
        "Top products",
        ["Product", "Rentals", "Units", "Earned"],
        [[row["name"], f"{row['rentals']:,}", f"{row['units']:,}", money(row["revenue"])] for row in report["products"][:10]],
        (0.5, 0.14, 0.14, 0.22),
        "No items came back in this period.",
        figures_from=1,
    )
    listing(
        "Top customers",
        ["Customer", "Rentals", "Spent", "Still owes"],
        [
            [row["name"], f"{row['rentals']:,}", money(row["revenue"]), money(row["outstanding"]) if row["outstanding"] > 0 else "—"]
            for row in report["customers"][:10]
        ],
        (0.42, 0.14, 0.22, 0.22),
        "Nobody returned anything in this period.",
        figures_from=1,
    )
    listing(
        "Who owes you",
        ["Customer", "Phone", "Still out", "Owes"],
        [
            [row["name"], row["phone"] or "—", f"{row['openRentals']:,}" if row["openRentals"] else "—", money(row["owed"])]
            for row in report["debtors"]
        ],
        (0.4, 0.24, 0.14, 0.22),
        "Nobody owes anything.",
        figures_from=2,
    )

    return sheet.build(f"{business['name']}  ·  Report {label}" if business["name"].isascii() else f"Report {label}")
