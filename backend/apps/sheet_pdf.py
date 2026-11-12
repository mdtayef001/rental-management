"""The printed sheet, as a PDF.

The browser prints receipts, bills and reports from one design (`components/paper.tsx` and
the `.sheet-table` rules in `globals.css` on the frontend). This is that same sheet drawn
with ReportLab, so the file someone downloads is the page that comes out of the printer:
the same type, the same teal, the same ruled tables, the same order.

Anything that changes how the sheet looks has to change in both places.
"""

import re
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# The sheet's own colours: `.bill-paper` in globals.css.
INK = colors.black
ACCENT = colors.HexColor("#0b4f59")
TINT = colors.HexColor("#dcecee")
LINE = colors.HexColor("#1f1f1f")
RULE = colors.HexColor("#6b6b6b")
SOFT = colors.HexColor("#262626")

# `@page { size: A4; margin: 12mm }`, and 10.5pt type at 1.35, as the print stylesheet sets.
MARGIN = 12 * mm
BASE = 10.5
LEADING = 1.35
THIN = 0.75  # a 1px rule
# ReportLab pads the inside of a page's frame by this much; the margins give it back.
PAD = 6

FONT_DIR = Path(__file__).resolve().parent / "fonts"
FONTS = {
    "Sheet": "Archivo-Regular.ttf",
    "Sheet-Semi": "Archivo-SemiBold.ttf",
    "Sheet-Bold": "Archivo-Bold.ttf",
    "Sheet-Mono": "IBMPlexMono-Regular.ttf",
    "Sheet-Bn": "NotoSansBengali-Regular.ttf",
    "Sheet-Bn-Bold": "NotoSansBengali-Bold.ttf",
}
# The taka sign and Bengali letters, which Archivo has no glyphs for.
BENGALI = re.compile(r"[ঀ-৿]+")
CURRENCY_SYMBOL = {"BDT": "৳", "USD": "$", "EUR": "€", "GBP": "£", "INR": "₹"}

_registered = None


def register_fonts():
    """True once the sheet's own fonts are loaded; False leaves the built-in ones in use."""
    global _registered
    if _registered is None:
        try:
            for name, file in FONTS.items():
                pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))
            _registered = True
        except Exception:  # pragma: no cover - the fonts ship with the code
            _registered = False
    return _registered


def cash(amount, currency):
    """Money as the screen writes it: ৳1,200.00, with a true minus sign."""
    value = amount or 0
    if not register_fonts():
        return f"{'-' if value < 0 else ''}{currency} {abs(value):,.2f}"
    symbol = CURRENCY_SYMBOL.get(currency, f"{currency} ")
    return f"{'−' if value < 0 else ''}{symbol}{abs(value):,.2f}"


def day(value):
    """A date as `3 Nov 2026`. Times are read in the shop's own time zone."""
    if value is None:
        return "—"
    if hasattr(value, "hour"):
        value = timezone.localtime(value)
    return f"{value.day} {value.strftime('%b %Y')}"


def logo_of(business):
    """The business's logo as bytes, or None when it has not uploaded one."""
    from apps.accounts.models import BusinessLogo

    if not business.logo_version:
        return None
    row = BusinessLogo.objects.filter(business=business).only("data").first()
    return bytes(row.data) if row else None


def logo_image(data, max_width=156, max_height=48):
    """The logo scaled to fit the top of a sheet, keeping its shape. None if it can't be drawn.

    The same box the sheet gives it on screen (`max-h-16 max-w-52`). A logo that fails to
    load must never cost the owner their bill, so any trouble reading it leaves it off.
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


class Sheet:
    """One document on the sheet: its styles, its building blocks and the page they go on."""

    def __init__(self, title, author):
        own = register_fonts()
        self.regular = "Sheet" if own else "Helvetica"
        self.semi = "Sheet-Semi" if own else "Helvetica-Bold"
        self.bold = "Sheet-Bold" if own else "Helvetica-Bold"
        self.mono = "Sheet-Mono" if own else "Courier"
        self.own = own
        self.buffer = BytesIO()
        self.doc = SimpleDocTemplate(
            self.buffer, pagesize=A4, leftMargin=MARGIN - PAD, rightMargin=MARGIN - PAD, topMargin=MARGIN - PAD,
            bottomMargin=MARGIN + 4 * mm, title=title, author=author,
        )
        self.width = self.doc.width - 2 * PAD
        self.story = []
        self._styles = {}

    # ---- Type ----

    def style(self, size=1.0, weight="regular", align="left", color=INK, mono=False):
        """A paragraph style. `size` is in ems of the sheet's 10.5pt, as the stylesheet has it."""
        key = (size, weight, align, color.hexval(), mono)
        if key not in self._styles:
            font = self.mono if mono else {"regular": self.regular, "semi": self.semi, "bold": self.bold}[weight]
            self._styles[key] = ParagraphStyle(
                f"s{len(self._styles)}", fontName=font, fontSize=BASE * size, leading=BASE * size * LEADING,
                textColor=color, alignment=TA_RIGHT if align == "right" else TA_LEFT,
            )
        return self._styles[key]

    def markup(self, text, bold=False):
        """Text made safe for a paragraph, with Bengali handed to a font that can draw it."""
        text = escape(str(text))
        if not self.own:
            return text
        font = "Sheet-Bn-Bold" if bold else "Sheet-Bn"
        return BENGALI.sub(lambda m: f'<font name="{font}">{m.group(0)}</font>', text)

    def p(self, text, **kwargs):
        return Paragraph(self.markup(text, kwargs.get("weight") in ("semi", "bold")), self.style(**kwargs))

    def rich(self, parts, **kwargs):
        """One paragraph from pieces in different faces: `[(text, "bold" | "mono" | ""), ...]`."""
        out = []
        for text, face in parts:
            piece = self.markup(text, face == "bold")
            if face == "bold":
                piece = f'<font name="{self.bold}">{piece}</font>'
            elif face == "mono":
                piece = f'<font name="{self.mono}">{piece}</font>'
            out.append(piece)
        return Paragraph("".join(out), self.style(**kwargs))

    def caption(self, text, align="left"):
        """The small teal heading over a box or a table."""
        return Paragraph(
            f'<font name="{self.bold}">{self.markup(str(text).upper(), True)}</font>',
            ParagraphStyle("caption", parent=self.style(size=0.82, weight="bold", align=align, color=ACCENT), charSpace=0.25),
        )

    def gap(self, points):
        self.story.append(Spacer(1, points))

    def add(self, *flowables):
        self.story.extend(flowables)

    # ---- The blocks every sheet is made of ----

    def header(self, business, logo, title, lines):
        """Who it is from on the left, what it is on the right, over a teal rule.

        `lines` are the lines under the title, each `(text, weight, mono)`.
        """
        left = []
        image = logo_image(logo)
        if image is not None:
            left += [image, Spacer(1, 6)]
        left.append(self.p(business["name"], size=15 / BASE, weight="bold"))
        for line in (business.get("branch"), business.get("address"), business.get("phone")):
            if line:
                left.append(self.p(line, color=SOFT))
        right = [
            Paragraph(
                self.markup(title.upper(), True),
                ParagraphStyle(
                    "title", parent=self.style(size=13.5 / BASE, weight="bold", align="right", color=ACCENT), charSpace=0.35
                ),
            )
        ]
        for text, weight, mono in lines:
            right.append(self.p(text, weight=weight, mono=mono, align="right"))
        self.story.append(
            Table(
                [[left, right]],
                colWidths=[self.width * 0.6, self.width * 0.4],
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                        ("LINEBELOW", (0, 0), (-1, -1), 1.5, ACCENT),
                    ]
                ),
            )
        )

    def boxes(self, cells, widths, tinted=()):
        """Ruled boxes side by side. `cells` are lists of flowables; `tinted` names the teal ones."""
        style = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), THIN, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]
        style += [("BACKGROUND", (i, 0), (i, 0), TINT) for i in tinted]
        return Table([cells], colWidths=[self.width * w for w in widths], style=TableStyle(style))

    def table(self, head, rows, widths, figures_from, total=None, width=None, spans=()):
        """A table on the sheet, ruled both ways, with a tinted teal heading row.

        Columns from `figures_from` on are numbers and sit to the right; pass a set of
        column numbers instead when the figures are not all at the end. A cell is text, a
        list of flowables, or a ready-made flowable. `total` is the bold closing row.
        `spans` are extra `(start_col, end_col, row)` merges, counted from the first body row.
        """
        width = self.width if width is None else width

        def figure(index):
            return index in figures_from if isinstance(figures_from, (set, frozenset)) else index >= figures_from

        def cell(value, index, weight="regular"):
            if value is None or value == "":
                return ""
            if isinstance(value, (list, Paragraph)):
                return value
            return self.p(value, align="right" if figure(index) else "left", weight=weight)

        data = [
            [
                Paragraph(
                    self.markup(text.upper(), True),
                    ParagraphStyle(
                        f"th{i}",
                        parent=self.style(size=0.82, weight="bold", color=ACCENT, align="right" if figure(i) else "left"),
                        charSpace=0.25,
                    ),
                )
                for i, text in enumerate(head)
            ]
        ]
        data += [[cell(value, i) for i, value in enumerate(row)] for row in rows]
        style = [
            ("GRID", (0, 0), (-1, -1), THIN, RULE),
            ("BOX", (0, 0), (-1, -1), THIN, LINE),
            ("GRID", (0, 0), (-1, 0), THIN, LINE),
            ("BACKGROUND", (0, 0), (-1, 0), TINT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5.5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5.5),
            ("TOPPADDING", (0, 0), (-1, -1), 3.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        style += [("SPAN", (start, row + 1), (end, row + 1)) for start, end, row in spans]
        if total:
            cells, span = total
            data.append([cell(value, i, weight="bold") for i, value in enumerate(cells)])
            style.append(("LINEABOVE", (0, -1), (-1, -1), THIN, LINE))
            if span:
                style.append(("SPAN", (span[0], -1), (span[1], -1)))
        return Table(data, colWidths=[width * w for w in widths], repeatRows=1, style=TableStyle(style))

    def sums(self, rows, total=None, width=None):
        """A ruled box of sums: a label and its figure per line, and a tinted total to close."""
        width = self.width if width is None else width
        data = [[self.p(label), self.p(value, weight="semi", align="right")] for label, value in rows]
        style = [
            ("BOX", (0, 0), (-1, -1), THIN, LINE),
            ("LINEBELOW", (0, 0), (-1, -2), THIN, RULE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7.5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7.5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        if total:
            label, value = total
            data.append([self.p(label, weight="bold"), self.p(value, weight="bold", size=1.15, align="right")])
            style += [
                ("LINEABOVE", (0, -1), (-1, -1), THIN, LINE),
                ("BACKGROUND", (0, -1), (-1, -1), TINT),
                ("TOPPADDING", (0, -1), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 6.5),
            ]
        return Table(data, colWidths=[width * 0.56, width * 0.44], style=TableStyle(style))

    def side_by_side(self, left, right, left_width, right_width, gutter=15):
        """Two stacks of flowables in columns, their tops level."""
        return Table(
            [[left or "", "", right or ""]],
            colWidths=[left_width, gutter, right_width],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        )

    def note(self, text):
        """A plain ruled line of text: an empty table's message."""
        return Table(
            [[self.p(text)]],
            colWidths=[self.width],
            style=TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), THIN, RULE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7.5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            ),
        )

    def signatures(self, left, left_name, business_name):
        """Room to sign by hand: the customer on the left, the shop on the right."""
        gutter = 72
        column = (self.width - gutter) / 2
        self.story.append(
            KeepTogether(
                [
                    Spacer(1, 48),
                    Table(
                        [
                            [
                                [self.p(left, size=0.9, color=SOFT), self.p(left_name, size=0.9, weight="semi")],
                                "",
                                [
                                    self.p("Authorised signature", size=0.9, color=SOFT, align="right"),
                                    self.p(f"For {business_name}", size=0.9, weight="semi", align="right"),
                                ],
                            ]
                        ],
                        colWidths=[column, gutter, column],
                        style=TableStyle(
                            [
                                ("LINEABOVE", (0, 0), (0, 0), THIN, INK),
                                ("LINEABOVE", (2, 0), (2, 0), THIN, INK),
                                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ]
                        ),
                    ),
                ]
            )
        )

    # ---- The file ----

    def build(self, foot):
        """The finished PDF as bytes. `foot` is printed small at the bottom of every page."""

        def footer(canvas, document):
            canvas.saveState()
            canvas.setFont(self.regular, 7.5)
            canvas.setFillColor(RULE)
            canvas.drawString(MARGIN, 7 * mm, foot)
            canvas.drawRightString(A4[0] - MARGIN, 7 * mm, f"Page {document.page}")
            canvas.restoreState()

        self.doc.build(self.story, onFirstPage=footer, onLaterPages=footer)
        return self.buffer.getvalue()
