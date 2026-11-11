---
name: Rental Manager
description: A counter-side rental system for stock that is counted, scanned out, and scanned back.
colors:
  ink-blue: "oklch(0.513 0.189 263)"
  ink-blue-dark: "oklch(0.636 0.165 263)"
  paper: "oklch(0.986 0.002 258)"
  card-white: "oklch(1 0 0)"
  ink: "oklch(0.192 0.013 263)"
  ink-quiet: "oklch(0.504 0.013 263)"
  rule: "oklch(0.913 0.005 260)"
  shelf: "oklch(0.974 0.003 258)"
  late: "oklch(0.561 0.207 25.5)"
  late-soft: "oklch(0.955 0.025 25.5)"
  late-soft-ink: "oklch(0.44 0.17 25.5)"
  due: "oklch(0.606 0.138 62)"
  due-soft: "oklch(0.962 0.035 75)"
  due-soft-ink: "oklch(0.44 0.105 62)"
  settled: "oklch(0.531 0.117 158)"
  settled-soft: "oklch(0.955 0.035 158)"
  settled-soft-ink: "oklch(0.42 0.095 158)"
  note-soft: "oklch(0.955 0.03 263)"
  note-soft-ink: "oklch(0.45 0.17 263)"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
  pill: "1.3rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "36px"
  badge-late:
    backgroundColor: "{colors.late-soft}"
    textColor: "{colors.late-soft-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
    typography: "{typography.label}"
  badge-due:
    backgroundColor: "{colors.due-soft}"
    textColor: "{colors.due-soft-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
  badge-settled:
    backgroundColor: "{colors.settled-soft}"
    textColor: "{colors.settled-soft-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
---

# Design System: Rental Manager

## Overview

**Creative North Star: "The Shop Counter"**

The screen is a work surface at the counter, not a dashboard someone admires. Things are
picked up, counted, handed over and written down on it. It is read standing up, often on a
phone held in one hand while the other hand holds a sewing machine, under the flat tube
lighting of a hire shop. Every decision in this system follows from that scene: the ground
is paper rather than pure white because a glaring screen is tiring across a nine-hour day;
controls are 36px tall because they are finger targets, not mouse targets; and the figures
are set in tabular numerals globally, because this app is a wall of quantities, money and
day counts that have to line up in a column.

The system is deliberately quiet so that the few loud things can be heard. There is one
accent colour and it means "press this" or "you are here". There are three status colours
and they mean late, due and settled — nothing decorative is permitted to borrow them. Depth
is a step in lightness, never a shadow. The result is a surface where the only things
competing for attention are stock, money and the clock, which is the correct hierarchy for
a business whose entire risk is that something went out and did not come back.

Numbers are the content; everything else is furniture. A screen that makes the reader do
arithmetic has failed, which is why an overdue rental is shown as a solid block reading
"9 days" rather than a due date, and why rent is charged and displayed only when items come
back and the price is finally known.

**Key Characteristics:**

- Paper ground, ink text, no glare — never pure white, never pure black
- One signal colour; three status colours that nothing else may use
- Flat surfaces, tonal depth, hairline rules
- Finger-sized controls throughout, because the primary device is a phone at a counter
- Tabular figures everywhere; monospace reserved for codes checked against a printed label
- One loud element per screen, and it is whatever needs a phone call

## Colors

A low-chroma neutral ground carrying a single blue signal and a strict three-colour status
vocabulary; nothing in the palette is decorative.

### Primary

- **Ink Blue** (`oklch(0.513 0.189 263)`): The pen on the paper ground — used where a person
  would have signed, ticked or underlined. It marks the primary action, the active page in
  the sidebar, the focus ring, links, and the first chart series. It is not a background, a
  mood, or a brand wash. In dark mode it lifts to `oklch(0.636 0.165 263)` so it stays legible
  against the dark ground rather than sinking into it.

### Neutral

- **Paper** (`oklch(0.986 0.002 258)`): The page ground. Very slightly warm-neutral off-white,
  chosen against glare under tube lighting.
- **Card White** (`oklch(1 0 0)`): Pure white, used only for cards and popovers, so a card
  reads as a sheet laid on the page rather than a box drawn on it.
- **Shelf** (`oklch(0.974 0.003 258)`): The sidebar ground, one step below the page so
  navigation recedes behind content.
- **Ink** (`oklch(0.192 0.013 263)`): Body and heading text. A very dark desaturated blue-grey,
  never pure black.
- **Quiet Ink** (`oklch(0.504 0.013 263)`): Secondary text, hints, axis labels, timestamps.
- **Rule** (`oklch(0.913 0.005 260)`): Borders, dividers, input strokes. A hairline, never a frame.

### Status

These three are the working vocabulary of a rental shop and are reserved absolutely. Each
has a solid value for emphasis and a soft tint with its own darker foreground for badge and
icon-tile backgrounds.

- **Late** (`oklch(0.561 0.207 25.5)`): Overdue rentals, destructive actions, supplier bills
  past due. The only red in the system.
- **Due** (`oklch(0.606 0.138 62)`): Due back today, unpaid balances, low stock — things that
  are not yet wrong but will be.
- **Settled** (`oklch(0.531 0.117 158)`): Returned, paid, nothing outstanding. Used sparingly;
  good news earns a quiet card, not a loud one.
- **Note** (`oklch(0.955 0.03 263)` soft): An informational tint drawn from Ink Blue, for
  states that are neither good nor bad — stock sent back and awaiting a supplier.

### Charts

The series ramp leads with Ink Blue and steps away from it through teal, green, amber and
violet, so series one always reads as "ours" and the rest stay distinguishable in both
themes. Every chart colour has a separate, lighter dark-mode value.

### Named Rules

**The One Signal Rule.** Ink Blue appears where a hand should go: the primary button, the
active nav item, the focus ring, a link. If it appears twice in the same decision, one of
them is wrong. It is never used to tint a surface or to make a section feel branded.

**The Reserved Status Rule.** Red, amber and green mean late, due and settled. No chart
accent, no illustration, no hover state and no empty-state graphic may use them for any
other purpose. A reader must be able to trust that red on this screen means money at risk.

**The No Pure White Rule.** The page ground is paper (`oklch(0.986 0.002 258)`). Pure white is
reserved for cards and popovers, where it does the work of lifting a sheet off the page.

## Typography

**Display / Body Font:** Archivo (with `ui-sans-serif, system-ui, sans-serif`)
**Code Font:** IBM Plex Mono (with `ui-monospace, monospace`)

**Character:** Archivo is a grotesque with a tall x-height and slightly condensed caps, which
is why it survives both 11px in a dense table and 32px on a stat tile without changing
personality. It is loaded with the width axis available and with tabular figures switched on
globally. The pairing is utilitarian rather than expressive: the type is there to be read
quickly at an angle, not admired.

### Hierarchy

- **Display** (600, 1.5rem, tracking -0.025em): Page titles on desktop (`sm:text-2xl`).
  Balanced wrapping, one per screen.
- **Headline** (600, 1.25rem, tracking -0.025em): The same page title at phone width.
- **Title** (500, 1rem, leading-snug): Card titles. Set in the heading family at medium weight,
  never bold — a card title labels a panel, it does not announce it.
- **Body** (400, 0.875rem): The default size for essentially everything, including table cells
  and form controls. Descriptive paragraphs cap at `max-w-prose`.
- **Label** (500, 0.75rem): Hints, timestamps, metadata, chart axes. Usually in Quiet Ink.
- **Code** (400, 0.75rem, IBM Plex Mono): Rental numbers, SKUs, barcodes.

### Named Rules

**The Tabular Figures Rule.** `font-variant-numeric: tabular-nums` is set on `html` and is not
to be overridden. Every quantity, price and day count is compared down a column, so a 1 and
a 7 must occupy the same width.

**The Mono Is Machine-Readable Rule.** IBM Plex Mono marks strings a person checks character
by character against a printed label — `RN-000004`, a SKU, a barcode. Monospace is never used
to make an ordinary label look technical.

**The 14px Floor Rule.** Body text is 0.875rem. Inputs render at 1rem on phones
(`text-base md:text-sm`) so iOS does not zoom the viewport when a field takes focus.

## Layout

A fixed sidebar shell with a single centred content column. Content is capped at `max-w-6xl`
and centred, with `px-3 py-5` at phone width opening to `px-6 py-6` from the `sm` breakpoint.
Vertical rhythm inside a page is a deliberate cadence rather than one repeated value: tight
between things that belong to the same thought (24px), a step between zones (32px), and a
generous break where the page changes from what needs you now to what is merely true (48px).
`gap-3` binds a row of stat tiles and `gap-4` separates full cards.

**The Shared Gridline Rule.** Card rows on one page resolve to the same underlying grid, so a
card edge in one row lines up with a card edge in the next: quarters for a row of four stat
tiles, halves for rows of two. A row that splits 2:1 against neighbours that split in half
reads as misaligned even when every card is individually correct.

**The No Manufactured Void Rule.** Cards in a row end level only when the content can honestly
reach the bottom. A chart is stretched to fill its row because a taller plot is a better plot;
a short list is never stretched, because the space inside it would be empty. Where two lists
of different lengths sit side by side, the row aligns to the top and the cards keep their own
heights — ragged beats hollow.

The sidebar collapses to an icon rail and its open state is stored in a cookie read on the
server, so the shell renders in the state the person left it rather than snapping wide after
paint. Below `md`, the sidebar is replaced by a sticky bottom bar respecting
`env(safe-area-inset-bottom)`. It carries Scan, Rent out, Take back and Rentals, plus
"More", which opens the full menu as a sheet — the counter's two actions sit under the
thumb on every screen, which is what the Thumb Reach Rule below asks for. The sidebar's
first group, Today, carries the same actions (Dashboard, Rent out, Take back, Scan), so on
a laptop they are one click from anywhere rather than a button on some pages.

Moving between screens shows a skeleton of the shared page shape at once
(`app/(app)/loading.tsx`) and the arriving screen fades in over 160ms (`.page-enter`,
opacity only, skipped under reduced motion).

Breakpoints follow Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Dashboard-class
grids go one column on a phone, two at `sm`, and their final three- or four-column form at
`lg`/`xl`. Grids holding cards of unequal content use `items-start` so a short card sits at
its natural height instead of being stretched into dead space by a taller neighbour.

### Named Rules

**The Thumb Reach Rule.** Any action a member of staff performs more than a few times a day
must be reachable at the bottom of a phone screen, not in a header.

**The No Stretched Card Rule.** A card's height is its content. Where a grid row mixes a long
list with a short one, the row aligns to the top; a bordered card with a void inside it reads
as broken.

## Elevation & Depth

This system is flat. In-page surfaces cast no shadow at all; depth is a step in lightness
through a four-stop tonal stack — sidebar (`Shelf`) sits below the page (`Paper`), which sits
below a card (`Card White`), which sits below a popover. Cards are separated from the page by
a hairline ring (`ring-1 ring-foreground/10`) rather than a border or a lift.

Shadows exist in exactly one role: marking something as genuinely detached from the page.
Dropdowns, selects, popovers, sheets and the chart tooltip carry a shadow because they float
above the document and must not be mistaken for part of it. The only other use is the
`shadow-sm` on an active tab thumb and the sidebar's floating rail.

### Shadow Vocabulary

- **Overlay** (`box-shadow: var(--shadow-md)`, Tailwind `shadow-md`): Dropdown menus, selects,
  popovers.
- **Panel** (`shadow-lg`): Sheets and side panels that cover content.
- **Tooltip** (`shadow-xl`): The chart tooltip, which floats over a dense plot and needs the
  most separation.

### Named Rules

**The Flat Surface Rule.** Surfaces never cast shadows. Depth is a step in lightness, not a
lift: sidebar < background < card < popover. A shadow in this app means a true overlay —
dialog, dropdown, sheet, tooltip — and nothing else.

## Shapes

Corners are derived from a single `--radius: 0.5rem`, scaled to a ladder: `sm` ×0.6, `md` ×0.8,
`lg` ×1, `xl` ×1.4, up to `4xl` ×2.6. Buttons and inputs use `lg` (8px); cards use `xl` (11.2px),
so a card reads as a slightly softer object than the controls inside it. Badges use the top of
the ladder and come out as pills.

Borders are hairlines and are used to divide, not to frame. Cards carry a translucent ring
rather than a solid border so they sit correctly on both the paper and the dark ground
without a second token. Small controls that sit inside a button group clamp their radius
(`rounded-[min(var(--radius-md),12px)]`) so a row of joined controls keeps a consistent outer
silhouette.

### Named Rules

**The Hairline Rule.** A coloured edge on a card, list item or callout is 1px. Thicker coloured
bars read as a costume; if an item needs more emphasis than a hairline, it needs a different
treatment, not a heavier stroke.

## Components

### Buttons

- **Shape:** Gently curved (`rounded-lg`, 8px), with smaller sizes clamping to 10–12px.
- **Height:** 36px default, 40px large, 32px small — deliberately taller than the shadcn
  defaults. This is a counter app used standing up; 32px is a mouse target, these are finger
  targets.
- **Primary:** Ink Blue ground, paper text, hover to 80% opacity. One per screen region.
- **Outline:** Page-coloured ground with a Rule border, hover to muted. The default partner to
  a primary action.
- **Ghost:** No ground until hover. Used for in-card navigation ("Reports →", "All →").
- **Destructive:** A soft red wash (`destructive/10`) with red text, not a solid red block.
  Deleting is a normal part of the job, not an alarm.
- **Focus:** A 3px Ink Blue ring at 50% opacity plus a border shift. Never removed.
- **Active:** Translates down 1px, except on menu triggers.

### Cards

- **Corner Style:** `rounded-xl` (11.2px).
- **Background:** Card White on paper; one tonal step up in dark mode.
- **Shadow Strategy:** None. A hairline `ring-1 ring-foreground/10` separates it from the page.
- **Internal Padding:** 16px via a `--card-spacing` custom property, dropping to 12px at
  `size="sm"`, so header, content and footer all breathe on one variable.
- **Title:** Medium weight, 1rem, leading-snug; description in Quiet Ink directly beneath;
  an optional action parks top-right on the title row.

### Inputs

- **Style:** Transparent ground with a Rule border at `rounded-lg`, 36px tall, 1rem text on
  phones and 0.875rem from `md` up.
- **Focus:** Border shifts to Ink Blue with a 3px ring at 50%.
- **Invalid:** Border and ring switch to Late red, driven by `aria-invalid` rather than a class.
- **Disabled:** Filled muted ground at 50% opacity with `cursor-not-allowed`.

### Badges

- **Style:** Pill (`rounded-4xl`), 20px tall, 12px medium text.
- **Status variants:** `warning`, `success`, `info` and `destructive` map to the soft status
  tints with their matching darker foregrounds. These say late, due soon and settled, and
  nothing else in the app may borrow them.

### Navigation

- **Sidebar:** Grouped by job — Today, Hire, Stock, Business — not by entity. Group labels are
  12px Quiet Ink. The active item takes an Ink Blue treatment; counts (e.g. overdue rentals)
  ride as a numeral at the right edge of the row.
- **Mobile:** A sticky bottom bar below `md` with a translucent background and backdrop blur,
  carrying Scan, Rent out, Take back, Rentals and More (`components/mobile-bar.tsx`).
- **Active item:** a soft tint of the signal colour with signal-coloured text
  (`bg-primary/12 text-primary`) — the one place the signal tints a row, because it means
  "you are here".

### The Day Marker (signature)

The chase list renders how late a rental is as a rankable tonal badge (`9d`) in three steps
rather than a continuous scale: 1–3 days a soft amber nudge, 4–14 days a red-tinted problem,
15+ days a solid red loss. A date makes the reader do arithmetic; a marker that darkens as it
worsens lets someone rank five rows at a glance.

The chase list no longer appears on the dashboard: overdue was reaching the reader three
times over (a stat tile, a Needs attention row, and the list itself), so the dashboard keeps
the two index entries and the queue lives on the overdue rentals page. `components/
overdue-list.tsx` holds the pattern and is currently unreferenced. Its rows are single lines
with a 24px marker; a screen that owns the chase as its whole job may render the same three
steps larger.

### The Stat Tile

Label in Quiet Ink, a 1.5rem semibold tabular value, an optional hint beneath, and a 36px
icon square on the right. Every tile is a link to the list behind it, because the next thing
anyone does with a number they dislike is look at what is in it.

**The Quiet Row Rule.** The tone lives on the icon square, never on the figure — a row of
coloured numbers reads as decoration and stops meaning anything, while a coloured square
beside a plain figure still says "this is the one to look at". That only holds while most
squares are uncoloured, so the default tone is neutral (`bg-muted`). A quiet day is a quiet
row; colour in a row of figures means something is actually warning or overdue.

## Do's and Don'ts

### Do:

- **Do** make every figure a link to the rows behind it.
- **Do** state a number in the unit the reader is about to act on — units still out, days late,
  money owed — and make sure the figure beside a label is actually a measure of that label.
- **Do** use the three status colours for status only, and give good news a quiet card.
- **Do** size controls for a finger: 36px minimum height for anything tapped at the counter.
- **Do** keep tabular figures on for every quantity, price and count.
- **Do** separate surfaces with a hairline and a step in lightness.
- **Do** let a card be as tall as its content (`items-start` on mixed-content grids).
- **Do** distinguish a failed request from an empty one — use `ErrorState` with a retry, never
  the empty-state copy.
- **Do** compute anything derived from the reader's clock in the browser, not during SSR.

### Don't:

- **Don't** use Ink Blue as a surface tint, a gradient, or a section background. It marks a
  hand's destination and nothing else.
- **Don't** put a shadow on an in-page surface. Flat is the rule; shadows mean true overlays.
- **Don't** draw a coloured edge thicker than 1px on a card, list item or callout.
- **Don't** use pure white for the page ground or pure black for text.
- **Don't** use monospace for ordinary labels; it is reserved for codes checked against a label.
- **Don't** plot a sparse server series directly — fill the missing periods so an axis labelled
  "the last 30 days" actually spans thirty days.
- **Don't** add a second loud element to a screen that already has one.
