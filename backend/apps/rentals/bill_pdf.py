"""A bill as a PDF file: the thing the owner attaches to an email or sends on WhatsApp.

Drawn from the same dictionary the screen shows (`statements.build_statement`), so the file
a company receives can never say something the owner's screen didn't.

A4, black on white, one table per rental. The fonts are the Latin ones bundled with
ReportLab, which is why money is written with the currency code ("BDT 1,200.00") rather
than a symbol the font may not carry. Text in other scripts prints correctly from the
browser's own Print button on the bill page, which uses the fonts on the computer.
"""

from io import BytesIO
from xml.sax.saxutils import escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#374151")
RULE = colors.HexColor("#4b5563")
TINT = colors.HexColor("#dcecee")

PLAN_LABEL = {"daily": "day", "weekly": "week", "monthly": "month", "fixed": "fixed"}
TITLE = {"month": "Monthly bill", "year": "Yearly bill", "custom": "Bill"}
BACK_NOTE = {"damaged": "damaged", "lost": "not returned"}


def fonts():
    """Vera ships inside ReportLab and covers far more accented Latin than Helvetica does."""
    try:
        if "Bill" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("Bill", "Vera.ttf"))
            pdfmetrics.registerFont(TTFont("Bill-Bold", "VeraBd.ttf"))
        return "Bill", "Bill-Bold"
    except Exception:  # pragma: no cover - the bundled fonts are always there in practice
        return "Helvetica", "Helvetica-Bold"


def logo_of(business):
    """The business's logo as bytes, or None when it has not uploaded one."""
    from apps.accounts.models import BusinessLogo

    if not business.logo_version:
        return None
    row = BusinessLogo.objects.filter(business=business).only("data").first()
    return bytes(row.data) if row else None


def logo_image(data, max_width=46 * mm, max_height=18 * mm):
    """The logo scaled to fit the top of a sheet, keeping its shape. None if it can't be drawn.

    A logo that fails to load must never cost the owner their bill, so any trouble reading
    the picture simply leaves it off.
    """
    if not data:
        return None
    try:
        from reportlab.lib.utils import ImageReader

        width, height = ImageReader(BytesIO(data)).getSize()
        scale = min(max_width / width, max_height / height)
        image = Image(BytesIO(data), width=width * scale, height=height * scale)
        image.hAlign = "LEFT"
        return image
    except Exception:
        return None


def sender_block(business, logo, p, head, small):
    """Who the sheet is from: the logo when there is one, then the name and how to reach them."""
    block = []
    image = logo_image(logo)
    if image is not None:
        block += [image, Spacer(1, 2 * mm)]
    block.append(p(business["name"], head))
    for line in (business.get("address"), business.get("phone")):
        if line:
            block.append(p(line, small))
    return block


def cash(amount, currency):
    value = amount or 0
    return f"{'-' if value < 0 else ''}{currency} {abs(value):,.2f}"


def day(value):
    if value is None:
        return "—"
    if hasattr(value, "hour"):
        value = timezone.localtime(value)
    return f"{value.day} {value.strftime('%b %Y')}"


def filename(statement):
    name = "".join(c if c.isalnum() else "-" for c in statement["customer"]["name"]).strip("-") or "customer"
    return f"{statement['number']}-{name}.pdf"


def render(statement, logo=None):
    """The bill as PDF bytes. `logo` is the business's logo as PNG or JPEG bytes, if it has one."""
    regular, bold = fonts()
    currency = statement["business"]["currency"]
    totals = statement["totals"]

    def style(name, **kwargs):
        kwargs.setdefault("fontName", regular)
        kwargs.setdefault("fontSize", 9)
        kwargs.setdefault("leading", kwargs["fontSize"] * 1.35)
        kwargs.setdefault("textColor", INK)
        return ParagraphStyle(name, **kwargs)

    body = style("body")
    small = style("small", fontSize=8, textColor=MUTED)
    right = style("right", alignment=TA_RIGHT)
    head = style("head", fontName=bold, fontSize=16)
    title = style("title", fontName=bold, fontSize=13, alignment=TA_RIGHT)
    label = style("label", fontName=bold, fontSize=7.5, textColor=MUTED)
    strong = style("strong", fontName=bold)
    strong_right = style("strong-right", fontName=bold, alignment=TA_RIGHT)
    label_right = style("label-right", fontName=bold, fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT)

    def p(text, st=body):
        return Paragraph(escape(str(text)), st)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"{TITLE[statement['kind']]} {statement['number']}", author=statement["business"]["name"],
    )
    width = doc.width
    story = []

    # ---- Who it is from, and what it is ----
    business = statement["business"]
    sender = sender_block(business, logo, p, head, small)
    what = [
        p(TITLE[statement["kind"]], title),
        p(statement["label"], right),
        p(f"No. {statement['number']}", style("no", fontSize=8, textColor=MUTED, alignment=TA_RIGHT)),
        p(f"Issued {day(statement['issued_at'])}", style("iss", fontSize=8, textColor=MUTED, alignment=TA_RIGHT)),
    ]
    story.append(Table([[sender, what]], colWidths=[width * 0.58, width * 0.42], style=[("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(Spacer(1, 6 * mm))

    # ---- Who it is to, and the period ----
    customer = statement["customer"]
    to = [p("BILL TO", label), p(customer["company"] or customer["name"], strong)]
    if customer["company"]:
        to.append(p(customer["name"]))
    for line in (customer["address"], customer["phone"], customer["email"]):
        if line:
            to.append(p(line, small))
    period = [p("PERIOD", label), p(f"{day_from_iso(statement['from'])} to {day_from_iso(statement['to'])}")]
    if statement["as_of"]:
        period.append(p("This period is not over. Charges run to today.", small))
    period += [
        Spacer(1, 2 * mm),
        p("AMOUNT DUE", label),
        p(cash(totals["closing_balance"], currency), style("due", fontName=bold, fontSize=14)),
    ]
    story.append(
        Table(
            [[to, period]],
            colWidths=[width * 0.58, width * 0.42],
            style=[
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                ("LINEAFTER", (0, 0), (0, 0), 0.6, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ],
        )
    )
    story.append(Spacer(1, 6 * mm))

    # ---- What was taken ----
    # One row per group of units that share their dates: what went out, when, when it came
    # back, how many days that was and how many of them were not charged.
    cell = style("cell", fontSize=8)
    cell_right = style("cell-right", fontSize=8, alignment=TA_RIGHT)
    cell_small = style("cell-small", fontSize=7, textColor=MUTED)
    cell_small_right = style("cell-small-right", fontSize=7, textColor=MUTED, alignment=TA_RIGHT)
    columns = [width * w for w in (0.19, 0.07, 0.14, 0.14, 0.08, 0.06, 0.13, 0.19)]
    if not statement["rentals"]:
        story.append(p("Nothing was out on rent in this period.", small))
    for rental in statement["rentals"]:
        rows = [
            [
                p(f"{rental['code']}  ·  taken {day(rental['started_at'])}", strong),
                "", "", "", "", "", "",
                p(cash(rental["total"], currency), strong_right),
            ],
            [p(t, label) for t in ("ITEM", "QTY", "OUT", "BACK", "DAYS", "OFF", "RATE")] + [p("AMOUNT", label_right)],
        ]
        for line in rental["lines"]:
            rate = f"{line['rate']:,.2f}" + ("" if line["plan"] == "fixed" else f" / {PLAN_LABEL[line['plan']]}")
            for index, part in enumerate(line["stretches"]):
                item = ""
                if index == 0:
                    item = [p(line["product_name"], cell)]
                    if line["product_sku"]:
                        item.append(p(line["product_sku"], cell_small))
                if part["back_at"]:
                    back = [p(day(part["back_at"]), cell)]
                    if part["condition"] in BACK_NOTE:
                        back.append(p(BACK_NOTE[part["condition"]], cell_small))
                else:
                    back = p("Still out", cell)
                amount = [p(cash(part["rent"], currency), cell_right)]
                if part["late_fee"]:
                    amount.append(p(f"+ late {cash(part['late_fee'], currency)}", cell_small_right))
                if part["damage_fee"]:
                    amount.append(p(f"+ damage {cash(part['damage_fee'], currency)}", cell_small_right))
                rows.append(
                    [
                        item,
                        p(f"{part['quantity']:,}", cell),
                        p(day(part["out_at"]), cell),
                        back,
                        p(part["days"], cell),
                        p(part["days_off"] or "—", cell),
                        p(rate, cell),
                        amount,
                    ]
                )
        if rental["discount"]:
            rows.append([p("Discount", cell), "", "", "", "", "", "", p(cash(-rental["discount"], currency), cell_right)])

        story.append(
            Table(
                rows,
                colWidths=columns,
                repeatRows=2,
                style=TableStyle(
                    [
                        ("SPAN", (0, 0), (6, 0)),
                        ("BACKGROUND", (0, 0), (-1, 0), TINT),
                        # Ruled both ways, like the printed sheet.
                        ("GRID", (0, 1), (-1, -1), 0.5, RULE),
                        ("BOX", (0, 0), (-1, -1), 0.8, INK),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ]
                ),
            )
        )
        story.append(Spacer(1, 4 * mm))

    # ---- Payments ----
    if statement["payments"]:
        rows = [[p(t, label) for t in ("PAYMENT RECEIVED", "AGAINST", "HOW")] + [p("AMOUNT", label_right)]]
        for payment in statement["payments"]:
            how = " ".join(x for x in (payment["method"], payment["reference"]) if x) or "—"
            rows.append([p(day(payment["at"])), p(payment["rental_code"]), p(how), p(cash(payment["amount"], currency), right)])
        story.append(
            Table(
                rows,
                colWidths=[width * 0.28, width * 0.22, width * 0.30, width * 0.20],
                style=TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
                        ("BOX", (0, 0), (-1, -1), 0.8, INK),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ]
                ),
            )
        )
        story.append(Spacer(1, 4 * mm))

    # ---- The sum ----
    sums = [("Balance brought forward", totals["opening_balance"]), ("Rent for this period", totals["rent"])]
    if totals["late_fee"]:
        sums.append(("Late fees", totals["late_fee"]))
    if totals["damage_fee"]:
        sums.append(("Damage and loss", totals["damage_fee"]))
    if totals["discount"]:
        sums.append(("Discount", -totals["discount"]))
    sums.append(("Payments received", -totals["paid"]))
    rows = [[p(name), p(cash(value, currency), right)] for name, value in sums]
    due_label = "Amount due" if totals["closing_balance"] >= 0 else "In credit"
    rows.append([p(due_label, strong), p(cash(abs(totals["closing_balance"]), currency), strong_right)])
    summary = Table(
        rows,
        colWidths=[width * 0.28, width * 0.22],
        hAlign="RIGHT",
        style=TableStyle(
            [
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, INK),
                ("BACKGROUND", (0, -1), (-1, -1), TINT),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        ),
    )
    closing = [summary]
    notes = []
    if totals["days_off"]:
        notes.append(f"{totals['days_off']:,} day(s) off were given in this period and are not charged.")
    if totals["units_out"]:
        notes.append(f"{totals['units_out']:,} unit(s) are still out on rent and continue to be charged.")
    if business["note"]:
        notes.append(business["note"])
    if notes:
        closing.append(Spacer(1, 5 * mm))
        closing += [p(note, small) for note in notes]
    story.append(KeepTogether(closing))

    # ---- Signatures ----
    # Room to sign by hand: the customer acknowledging the bill, and the owner issuing it.
    sign = style("sign", fontSize=8, textColor=MUTED)
    sign_name = style("sign-name", fontName=bold, fontSize=8.5)
    story.append(
        KeepTogether(
            [
                Spacer(1, 20 * mm),
                Table(
                    [
                        [
                            [p("Received by", sign), p(customer["company"] or customer["name"], sign_name)],
                            "",
                            [p("Authorised signature", sign), p(f"For {business['name']}", sign_name)],
                        ]
                    ],
                    colWidths=[width * 0.36, width * 0.28, width * 0.36],
                    style=TableStyle(
                        [
                            ("LINEABOVE", (0, 0), (0, 0), 0.8, INK),
                            ("LINEABOVE", (2, 0), (2, 0), 0.8, INK),
                            ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ]
                    ),
                ),
            ]
        )
    )

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(regular, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(document.leftMargin, 10 * mm, f"{business['name']}  ·  {statement['number']}")
        canvas.drawRightString(A4[0] - document.rightMargin, 10 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def day_from_iso(text):
    from datetime import date

    return day(date.fromisoformat(text))
