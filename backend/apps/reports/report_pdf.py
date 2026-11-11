"""The owner's report as a PDF: one sheet to print, file, or send to an accountant.

Drawn from `services.overview`, the same figures the Reports screen shows, and laid out
like a bill — the business and its logo at the top, black on white, A4 — so everything the
shop prints looks like it came from the same place.
"""

from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.rentals.bill_pdf import INK, MUTED, RULE, TINT, cash, day, fonts, sender_block

GROUP_LABEL = {"day": "Day", "week": "Week starting", "month": "Month"}


def render(report, logo=None):
    """The report as PDF bytes. `logo` is the business's logo as PNG or JPEG bytes, if any."""
    regular, bold = fonts()
    business = report["business"]
    currency = business["currency"]
    s = report["summary"]

    def style(name, **kwargs):
        kwargs.setdefault("fontName", regular)
        kwargs.setdefault("fontSize", 9)
        kwargs.setdefault("leading", kwargs["fontSize"] * 1.35)
        kwargs.setdefault("textColor", INK)
        return ParagraphStyle(name, **kwargs)

    body = style("body")
    small = style("small", fontSize=8, textColor=MUTED)
    right = style("right", alignment=TA_RIGHT)
    small_right = style("small-right", fontSize=8, textColor=MUTED, alignment=TA_RIGHT)
    head = style("head", fontName=bold, fontSize=16)
    title = style("title", fontName=bold, fontSize=13, alignment=TA_RIGHT)
    label = style("label", fontName=bold, fontSize=7.5, textColor=MUTED)
    label_right = style("label-right", fontName=bold, fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT)
    strong = style("strong", fontName=bold)
    strong_right = style("strong-right", fontName=bold, alignment=TA_RIGHT)
    figure = style("figure", fontName=bold, fontSize=13)
    section = style("section", fontName=bold, fontSize=10.5)

    def p(text, st=body):
        return Paragraph(escape(str(text)), st)

    def money(value):
        return cash(value, currency)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"Report {report['label']}", author=business["name"],
    )
    width = doc.width
    story = []

    # ---- Who it is from, and what it covers ----
    what = [
        p("Business report", title),
        p(report["label"], right),
        p(f"Printed {day(report['generated_at'])}", small_right),
    ]
    story.append(
        Table(
            [[sender_block(business, logo, p, head, small), what]],
            colWidths=[width * 0.58, width * 0.42],
            style=[("VALIGN", (0, 0), (-1, -1), "TOP")],
        )
    )
    story.append(Spacer(1, 6 * mm))

    # ---- The four figures an owner asks for first ----
    tiles = [
        ("EARNED", money(s["revenue"]), "Charged on items that came back"),
        ("MONEY RECEIVED", money(s["collected"] - s["refunded"]), "Taken, less anything given back"),
        ("OWED BY CUSTOMERS", money(s["outstanding"]), "As of today"),
        ("OUT ON RENT", f"{s['unitsOut']:,} units", f"{s['openRentals']:,} rentals, {s['overdue']:,} overdue"),
    ]
    story.append(
        Table(
            [[[p(name, label), p(value, figure), p(note, small)] for name, value, note in tiles]],
            colWidths=[width / 4] * 4,
            style=TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                    ("INNERGRID", (0, 0), (-1, -1), 0.6, RULE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            ),
        )
    )
    story.append(Spacer(1, 6 * mm))

    plain = [
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]

    # ---- Where the money came from, and what moved ----
    earned = [("Rent", s["rent"])]
    if s["lateFees"]:
        earned.append(("Late fees", s["lateFees"]))
    if s["damageFees"]:
        earned.append(("Damage and loss", s["damageFees"]))
    if s["discounts"]:
        earned.append(("Discounts given", -s["discounts"]))
    money_rows = [[p("EARNED IN THIS PERIOD", label), ""]]
    money_rows += [[p(name), p(money(value), right)] for name, value in earned]
    money_rows.append([p("Total earned", strong), p(money(s["revenue"]), strong_right)])
    money_rows.append([p("Paid in advance, not yet charged", small), p(money(s["advancesHeld"]), small_right)])

    moved = [
        ("Rentals started", s["rentals"]),
        ("Units sent out", s["unitsRented"]),
        ("Units returned", s["unitsReturned"]),
        ("Returns taken", s["returns"]),
        ("New customers", s["newCustomers"]),
    ]
    if s["unitsDamaged"]:
        moved.append(("Units returned damaged", s["unitsDamaged"]))
    if s["unitsLost"]:
        moved.append(("Units never returned", s["unitsLost"]))
    moved_rows = [[p("WHAT MOVED", label), ""]] + [[p(name), p(f"{value:,}", right)] for name, value in moved]

    half = width * 0.5 - 3 * mm
    story.append(
        Table(
            [
                [
                    Table(
                        money_rows,
                        colWidths=[half * 0.62, half * 0.38],
                        style=TableStyle(
                            plain
                            + [
                                ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
                                ("LINEABOVE", (0, -2), (-1, -2), 0.8, INK),
                                ("BACKGROUND", (0, -2), (-1, -2), TINT),
                            ]
                        ),
                    ),
                    "",
                    Table(
                        moved_rows,
                        colWidths=[half * 0.7, half * 0.3],
                        style=TableStyle(plain + [("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE)]),
                    ),
                ]
            ],
            colWidths=[half, 6 * mm, half],
            style=[
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ],
        )
    )

    def listing(heading, header, rows, widths, empty, right_from=1):
        """A titled table, as flowables. Columns from `right_from` on are figures, set right."""
        block = [Spacer(1, 7 * mm), p(heading, section), Spacer(1, 1.5 * mm)]
        if not rows:
            return [KeepTogether([*block, p(empty, small)])]
        data = [[p(text, label if i < right_from else label_right) for i, text in enumerate(header)]]
        for row in rows:
            data.append([p(text, body if i < right_from else right) for i, text in enumerate(row)])
        table = Table(
            data,
            colWidths=[width * w for w in widths],
            repeatRows=1,
            style=TableStyle(
                plain
                + [
                    ("GRID", (0, 0), (-1, -1), 0.5, RULE),
                    ("BOX", (0, 0), (-1, -1), 0.8, INK),
                    ("BACKGROUND", (0, 0), (-1, 0), TINT),
                ]
            ),
        )
        # A short table stays in one piece. A long one may run over the page, but only
        # starts where there is room for its heading and a few rows under it.
        if len(rows) <= 12:
            return [KeepTogether([*block, table])]
        return [CondPageBreak(30 * mm), *block, table]

    # ---- Earned over time ----
    group = report["group"]
    # One row for each thing that came back, so every figure names its customer and product.
    earned_rows = []
    for row in report["revenue"]:
        first = True
        for line in row["details"]:
            earned_rows.append(
                [
                    period(row["period"], group) if first else "",
                    line["customer"],
                    line["product"],
                    line["sku"] or line["barcode"] or "—",
                    f"{line['units']:,}",
                    money(line["amount"]),
                ]
            )
            first = False
        if row["discounts"]:
            earned_rows.append(["" if not first else period(row["period"], group), "Discount", "", "", "", money(-row["discounts"])])
    story.extend(
        listing(
            f"Earned per {group}",
            [GROUP_LABEL[group], "Customer", "Product", "SKU / barcode", "Units", "Earned"],
            earned_rows,
            (0.14, 0.22, 0.24, 0.16, 0.08, 0.16),
            "Nothing came back in this period, so nothing was charged.",
            right_from=4,
        )
    )

    # ---- What earned it, and who paid it ----
    story.extend(
        listing(
            "What earned the most",
            ["Product", "Rentals", "Units", "Earned"],
            [
                [
                    row["name"] + (f"  ({row['sku']})" if row["sku"] else ""),
                    f"{row['rentals']:,}",
                    f"{row['units']:,}",
                    money(row["revenue"]),
                ]
                for row in report["products"]
            ],
            (0.5, 0.14, 0.14, 0.22),
            "No items came back in this period.",
        )
    )
    story.extend(
        listing(
            "Best customers",
            ["Customer", "Rentals", "Spent", "Still owes"],
            [
                [
                    row["name"] + (f"  {row['phone']}" if row["phone"] else ""),
                    f"{row['rentals']:,}",
                    money(row["revenue"]),
                    money(row["outstanding"]) if row["outstanding"] > 0 else "—",
                ]
                for row in report["customers"]
            ],
            (0.46, 0.14, 0.2, 0.2),
            "Nobody returned anything in this period.",
        )
    )
    story.extend(
        listing(
            "Who owes you, as of today",
            ["Customer", "Phone", "Rentals still out", "Owes"],
            [
                [row["name"], row["phone"] or "—", f"{row['openRentals']:,}", money(row["owed"])]
                for row in report["debtors"]
            ],
            (0.38, 0.24, 0.18, 0.2),
            "Nobody owes anything. Every rental is paid up.",
            right_from=2,
        )
    )

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(regular, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(document.leftMargin, 10 * mm, f"{business['name']}  ·  Report {report['label']}")
        canvas.drawRightString(A4[0] - document.rightMargin, 10 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def period(text, group):
    """A bucket's first day, written the way the screen writes it."""
    value = date.fromisoformat(text)
    if group == "month":
        return value.strftime("%B %Y")
    return f"{value.day} {value.strftime('%b %Y')}"
