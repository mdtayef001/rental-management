"""A bill as a PDF file: the thing the owner attaches to an email or sends on WhatsApp.

Drawn from the same dictionary the screen shows (`statements.build_statement`), on the
same sheet the browser prints (`apps/sheet_pdf.py`), block for block: the file a company
receives looks like the page the owner printed and can never say something the owner's
screen didn't. It mirrors `BillDocument` in the frontend's `components/bill.tsx`.
"""

from datetime import date

from reportlab.platypus import HRFlowable, KeepTogether, Spacer

from apps.sheet_pdf import RULE, THIN, Sheet, cash, day, logo_of  # noqa: F401  (logo_of is used by the views)

TITLE = {"month": "Monthly bill", "year": "Yearly bill", "custom": "Bill"}
UNIT = {"daily": "per day", "weekly": "per week", "monthly": "per month"}
BACK_NOTE = {"damaged": "Damaged", "lost": "Not returned"}
# Item, Qty, Out, Back, Days, Off, Rate, Amount: the widths of the table on the sheet.
COLUMNS = (0.22, 0.07, 0.14, 0.14, 0.07, 0.07, 0.14, 0.15)
# Out and Back are dates; every other column after the item is a figure.
FIGURES = {1, 4, 5, 6, 7}


def filename(statement):
    name = "".join(c if c.isalnum() else "-" for c in statement["customer"]["name"]).strip("-") or "customer"
    return f"{statement['number']}-{name}.pdf"


def day_from_iso(text):
    return day(date.fromisoformat(text))


def render(statement, logo=None):
    """The bill as PDF bytes. `logo` is the business's logo as PNG or JPEG bytes, if it has one."""
    business = statement["business"]
    customer = statement["customer"]
    totals = statement["totals"]
    currency = business["currency"]
    due = totals["closing_balance"]
    due_label = "In credit" if due < 0 else "Amount due"

    def money(value):
        return cash(value, currency)

    sheet = Sheet(title=f"{TITLE[statement['kind']]} {statement['number']}", author=business["name"])
    p = sheet.p

    sheet.header(
        business,
        logo,
        TITLE[statement["kind"]],
        [
            (statement["label"], "semi", False),
            (statement["number"], "regular", True),
            (f"Issued {day(statement['issued_at'])}", "regular", False),
        ],
    )
    sheet.gap(15)

    # ---- Who it is to, and the figure that matters ----
    to = [sheet.caption("Bill to"), p(customer["company"] or customer["name"], weight="bold")]
    if customer["company"]:
        to.append(p(customer["name"]))
    for line in (customer["address"], customer["phone"]):
        if line:
            to.append(p(line))
    amount = [
        sheet.caption(due_label),
        p(money(abs(due)), size=18 / 10.5, weight="bold"),
        p(f"{day_from_iso(statement['from'])} to {day_from_iso(statement['to'])}"),
    ]
    sheet.add(sheet.boxes([to, amount], (1.4 / 2.4, 1 / 2.4), tinted=(1,)))
    sheet.gap(15)

    # ---- What was taken: one ruled table per rental ----
    if not statement["rentals"]:
        sheet.add(sheet.note("Nothing was out on rent in this period."))
        sheet.gap(12)
    for rental in statement["rentals"]:
        rows, spans = [], []
        for line in rental["lines"]:
            rate = [p(money(line["rate"]), align="right")]
            if line["plan"] in UNIT:
                rate.append(p(UNIT[line["plan"]], size=0.85, align="right"))
            for index, part in enumerate(line["stretches"]):
                if part["back_at"]:
                    back = [p(day(part["back_at"]))]
                    if part["condition"] in BACK_NOTE:
                        back.append(p(BACK_NOTE[part["condition"]], weight="semi"))
                else:
                    back = p("Still out")
                figure = [p(money(part["rent"]), align="right")]
                if part["late_fee"]:
                    figure.append(p(f"+ late {money(part['late_fee'])}", size=0.85, align="right"))
                if part["damage_fee"]:
                    figure.append(p(f"+ damage {money(part['damage_fee'])}", size=0.85, align="right"))
                rows.append(
                    [
                        line["product_name"] if index == 0 else "",
                        f"{part['quantity']:,}",
                        day(part["out_at"]),
                        back,
                        f"{part['days']:,}",
                        f"{part['days_off']:,}" if part["days_off"] else "—",
                        rate,
                        figure,
                    ]
                )
        if rental["discount"]:
            spans.append((0, 6, len(rows)))
            rows.append(["Discount", "", "", "", "", "", "", p(money(-rental["discount"]), align="right")])

        heading = sheet.rich(
            [(rental["code"], "mono"), (" · taken ", ""), (day(rental["started_at"]), "bold")],
        )
        table = sheet.table(
            ["Item", "Qty", "Out", "Back", "Days", "Off", "Rate", "Amount"],
            rows,
            COLUMNS,
            figures_from=FIGURES,
            total=(
                [p(f"Total for {rental['code']}", weight="bold", align="right"), "", "", "", "", "", "", p(money(rental["total"]), weight="bold", align="right")],
                (0, 6),
            ),
            spans=spans,
        )
        block = [heading, Spacer(1, 3), table, Spacer(1, 12)]
        # A rental stays in one piece unless it is too long to fit a page anyway.
        if len(rows) <= 14:
            sheet.add(KeepTogether(block))
        else:
            sheet.add(*block)

    # ---- Payments beside the summary ----
    right_width = 204  # 17rem
    left_width = sheet.width - right_width - 15
    left = []
    if statement["payments"]:
        left += [
            sheet.caption("Payments received"),
            Spacer(1, 3),
            sheet.table(
                ["Date", "Rental", "Paid by", "Amount"],
                [
                    [
                        day(payment["at"]),
                        p(payment["rental_code"], mono=True),
                        " · ".join(x for x in ((payment["method"] or "").capitalize(), payment["reference"]) if x) or "—",
                        money(payment["amount"]),
                    ]
                    for payment in statement["payments"]
                ],
                (0.26, 0.24, 0.26, 0.24),
                figures_from=3,
                width=left_width,
            ),
        ]
    lines = [("Brought forward", money(totals["opening_balance"])), ("Rent", money(totals["rent"]))]
    if totals["late_fee"]:
        lines.append(("Late fees", money(totals["late_fee"])))
    if totals["damage_fee"]:
        lines.append(("Damage and loss", money(totals["damage_fee"])))
    if totals["discount"]:
        lines.append(("Discount", money(-totals["discount"])))
    lines.append(("Paid", money(-totals["paid"])))
    right = [sheet.caption("Summary"), Spacer(1, 3), sheet.sums(lines, total=(due_label, money(abs(due))), width=right_width)]
    sheet.gap(3)
    sheet.add(KeepTogether([sheet.side_by_side(left, right, left_width, right_width)]))

    if business["note"]:
        sheet.gap(15)
        sheet.add(KeepTogether([HRFlowable(width="100%", thickness=THIN, color=RULE, spaceAfter=6), *[p(t) for t in business["note"].splitlines() if t.strip()]]))

    # Room to sign by hand: the customer acknowledging the bill, and the owner issuing it.
    sheet.signatures("Received by", customer["company"] or customer["name"], business["name"])
    return sheet.build(f"{business['name']}  ·  {statement['number']}" if business["name"].isascii() else statement["number"])

