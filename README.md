# Rental Management System

Rent stock out by scanning, take it back by scanning, and keep the books straight.

Built for a single client: a multi-tenant rental business where a super admin creates
businesses, each owner runs their own team, and stock is counted rather than serialised
(1,000 sewing machines are one product with a quantity of 1,000; 100 go out on a rental).

**No subscription or billing. No warehouses or stock transfers.**

---

## The feature this was built around

> *"When scanning in or returning, the same client may have rented multiple times, or the
> same product — it should show or ask which one he's returning."*

Scanning on the **Take back** screen resolves three different things through one endpoint,
`POST /api/rentals/resolve-return/`:

| You scan | It finds |
|---|---|
| A product barcode or SKU | Every open rental with that product still out |
| The QR code on a customer's receipt | That rental only |
| *(or you search)* a customer | Everything that customer has out |

If exactly one rental matches, the screen goes straight to it. If several do — the same
customer renting the same product twice, or two customers with the same item — it asks,
showing **who has it, which rental, how many are still out, how many days out, whether it
is overdue, and what it would cost if it all came back now**. The system never guesses:
guessing wrong closes the wrong rental and charges the wrong person.

Returns are partial by default. 100 machines go out, 60 come back today and the remaining
40 keep being charged until they do.

---

## Stack

**Backend** — Django 6.1, Django REST Framework, SimpleJWT, PostgreSQL (SQLite in dev).
**Frontend** — Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui on Base UI,
TanStack Query, html5-qrcode.

## Getting started

```bash
# Backend
cd backend
uv venv && uv pip install -r requirements.txt
cp .env.example .env          # then fill in the two generated keys
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo     # demo business and data
.venv/bin/python manage.py runserver

# Frontend (another terminal)
cd frontend
npm install
cp .env.example .env.local    # JWT_SIGNING_KEY must match backend/.env
npm run dev
```

Open http://localhost:3000.

### Demo logins (after `seed_demo`)

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@example.com` | `rental-demo-2026` |
| Owner | `owner@example.com` | `rental-demo-2026` |
| Manager | `manager@example.com` | `rental-demo-2026` |
| Staff | `staff@example.com` | `rental-demo-2026` |

Scan **`8801234567890`** on Take back: it is out with three rentals (two of them the same
customer), so the chooser has to ask which one.

## The deployed demo

| | |
|---|---|
| App | <https://rental-management-henna.vercel.app> |
| API | <https://rental-management-api-navy.vercel.app> |

Two Vercel projects off this one repository — `rental-management` (root `frontend/`) and
`rental-management-api` (root `backend/`) — both deploying on a push to `master`. The
database is a free Neon Postgres provisioned through the Vercel marketplace and connected
to the API project, so `DATABASE_URL` arrives as a pooled connection and
`DATABASE_TRANSACTION_POOLER=true` is set to match.

SQLite stays the development database and is not used in the deployment: Vercel's
filesystem is read-only apart from `/tmp`, which is per-instance and wiped when the
instance recycles, so a rental taken during a demo could vanish or appear only to some
requests.

Django runs as a single Vercel Python function. `backend/api/index.py` exposes the WSGI
app and `backend/vercel.json` routes every path to it with `routes`/`dest` rather than
`rewrites` — a rewrite replaces the path the function is handed, which makes Django answer
404 to everything, `/admin/` included.

The seeded one-click logins on the login page are shown in a production build only when
`NEXT_PUBLIC_SHOW_DEMO_LOGINS=true`. It is set on the demo deployment and should stay
unset anywhere real.

To rebuild the demo data against the deployment's database:

```bash
cd backend
DATABASE_URL="$NEON_UNPOOLED_URL" .venv/bin/python manage.py migrate
DATABASE_URL="$NEON_UNPOOLED_URL" .venv/bin/python manage.py createcachetable
DATABASE_URL="$NEON_UNPOOLED_URL" .venv/bin/python manage.py seed_demo --reset
```

`createcachetable` is needed because the login rate limit moves from local memory to a
database table whenever the database is PostgreSQL.

## Tests

```bash
cd backend  && .venv/bin/python manage.py test   # 111 tests
cd frontend && npm test && npm run typecheck     # 11 tests
```

The rental pricing exists on both sides — staff see it live in the form, the server charges
it — so `backend/apps/rentals/tests.py::QuoteTests` and
`frontend/src/lib/__tests__/rental.test.ts` run the **same cases**. Change one formula
without the other and a suite fails, rather than a customer quietly being charged something
different from their quote.

---

## How it is put together

### Security

1. **Tokens never reach JavaScript.** Access and refresh tokens live in httpOnly,
   sameSite=lax cookies. The browser calls `/api/backend/*`, a Next.js route handler that
   attaches the token server-side. An XSS bug in a dependency cannot steal a session.
2. **Three independent checks.** `proxy.ts` verifies the JWT and redirects before anything
   renders (and silently renews the access token). The DAL re-asks Django who the user is on
   every page, so disabling an account or suspending a business takes effect at once even
   with a valid token. Django authorises every API call regardless. The frontend's
   `roles.ts` and the backend's `permissions.py` encode the same rules, so a hidden route is
   also a refused one.
3. **Tenant isolation in two directions.** A shared base viewset filters every queryset to
   `request.user.business`; `TenantRelatedField` refuses any id that points outside it. A
   crafted request cannot read another tenant's rows or attach them to its own.
4. **Roles plus per-person rights.** owner / manager / staff, with `canRent`,
   `canTakeReturns`, `canSell`, `canAddStock` and `canHandleDeposits` per staff member, and
   owner-controlled manager permissions on top.
5. Login throttled to 5/min, password validators, no account enumeration, HSTS, nosniff and
   frame-deny in production.

### Correctness

- **Stock and rentals can never disagree.** Every unit off the shelf is on an open rental
  item and vice versa; both move in one transaction or neither does. A test asserts
  `on_shelf + still_out == 1000` after a partial return.
- **All stock changes go through one function** that locks the row, refuses to go negative
  and writes a ledger entry with a reason and a person. "Where did those 40 go" always has
  an answer.
- **Numbers are allocated under a per-business lock**, so two tills cannot take the same
  rental number — and numbering restarts per business, so nobody learns another tenant's volume.
- **Money is only final at return**, because the price depends on how long the item was
  actually out. Rates and plans are frozen onto the item when it goes out, so changing a
  product's price never rewrites a past rental.
- **Rent is recognised when earned** (at return), not when the rental started.

### Speed

- No endpoint returns an unbounded list: `?page=` with 50 by default, 200 maximum, searched
  and filtered in the database.
- Aggregates are database subqueries, never Python loops over a table — the dashboard costs
  the same at 50 rentals or 50,000.
- TanStack Query caches with a 30s stale time and `keepPreviousData`, so paging never blanks
  the screen. Mutations invalidate only the collections they touched.
- The camera scanner is a dynamic import, so its bundle only downloads when a scanner opens.

## Layout

```
backend/apps/
  accounts/    Business, Branch, User, roles, the super admin's platform API, audit log
  catalog/     Products, stock levels, the stock ledger, customers, the scanner lookup
  rentals/     Rentals, items, returns, payments, receipts  ← the core
  purchasing/  Suppliers, purchases, supplier returns, payments out
frontend/src/
  app/(app)/   The signed-in screens
  components/  Scanner, return chooser, navigation, shared UI
  lib/         api clients, auth (session/proxy/DAL/roles), queries, mutations, pricing
```

Each app keeps business logic in `services.py`: views validate input and decide who may
call, services do the work in one transaction.

## Design

The UI is shadcn/ui on Base UI, with the stock neutral theme replaced by one of our own.

**Colour carries meaning or it isn't used.** The chrome is a near-neutral ink, and a single
teal marks the primary action and the page you are on — nothing else. Amber, red and green
are reserved for rental status (due, late, settled), so a coloured figure on any screen
always means the same thing. Each status has a soft tint for badge backgrounds and a
separate darker ink for text on that tint, because an amber that reads well as a 3px bar
does not read well as 12px type. All of it is defined once as tokens in `globals.css`, in
both themes.

**One list, two shapes.** `components/data-view.tsx` takes a screen's columns and renders a
table on a laptop and stacked cards on a phone. A table is right at the counter — columns
of money and quantities line up and compare down the page — and wrong on a 390px screen,
where six columns become a horizontal scroll nobody finds. Both shapes are rendered and CSS
picks one, rather than branching in JavaScript, so the server and the browser agree and the
page never flashes. Alignment is dropped in the card: right-aligning exists so a column can
be read downward, and a card has no column.

Several patterns here are lifted from the Friday inventory app this was modelled on — the
stat card with its tinted icon tile, the "needs attention" list, the confirm dialog, the
tabbed scanner and the two-copy receipt — rebuilt in this palette rather than copied with
its colours.

**Navigation is grouped, not listed.** Thirteen links in one flat list is a list nobody
reads. They are now four short ones — Today, Hire, Stock, Money, Admin — in a sidebar that
collapses to an icon rail for more table width, and becomes a sheet on a phone with the
three counter actions in a bottom bar. **Ctrl-K** opens a palette that jumps to a screen or
straight to a customer or machine by name; it offers only screens the person can actually
open, from the same rules the server enforces.

Buttons and inputs are taller than the shadcn defaults. This is used standing up, often on
a phone, sometimes by someone holding a machine in the other hand: 32px is a mouse target,
not a finger target.

**Archivo** for the interface — a grotesque with a tall x-height that holds up at 11px in a
dense table and at 32px on a figure. Tabular figures are on globally, because nearly every
screen is a column of quantities, money or day counts. **IBM Plex Mono** is used only for
machine codes (`RN-000001`, SKUs, barcodes): strings people compare character by character
against a printed label, where fixed widths are information rather than decoration.

The dashboard is arranged by urgency, not by category. The **chase list** of overdue
rentals is the one loud element on the page, because it is the only thing that asks anyone
to do something. Each row carries a day block whose colour steps at 1–3 days (a nudge),
4–14 (a real problem) and 15+ (stock at risk), so five rows can be ranked at a glance
without reading dates — and the customer's phone number sits in the row, because the next
action after reading it is a phone call.

## Screens

All built: login, dashboard, scan, rent out, take back, rentals (list + detail), returns,
customers (list + detail), products (list + detail with printable QR labels), stock,
purchases, suppliers, sent back to supplier, reports, team, activity, settings, the super
admin's platform page, and the public receipt a customer opens from their QR code.

There is no separate Stock screen either: the products list already carries what is on
the shelf, what is out on rent and the total, and corrections are made from the row.

There is no Branches screen. A business is created with exactly one branch and the branch
pickers never render; the model and the `branch` column on stock, rentals and purchases
stay as the seam for a second location later.

## Reports

Four questions in the order an owner asks them: what did we earn, when did we earn it,
which machines earned it, who still owes us. The one thing to know about the figures is
that **rent is earned at return, not at rent-out** — the price depends on how long the
items were actually out, so "Earned" totals the returns taken in the range while "Rentals
started" counts what went out in it. They are deliberately different numbers.

Every block downloads as CSV, and three full ledgers (rentals, returns, payments) are
there for an accountant. Exports stream row by row rather than being built in memory, and
a cell that starts `=`, `+`, `-` or `@` is prefixed with an apostrophe so a customer named
`=HYPERLINK(…)` cannot run a formula on the owner's machine when the file is opened.

## Receipts

Each rental's receipt exists in two copies, rendered from the same data so the paper can
never say something the screen doesn't.

The **screen copy** is an ordinary page in the app's colours, because a receipt is read
far more often than it is printed — usually by someone checking what a customer owes. The
**till copy** is laid out as a shop slip: 80mm wide, solid black on white (thermal
printers turn grey into speckles), each item's figures on their own line. It is measured
as it renders and the printed page is sized to exactly its own height, so one rental is
one strip of paper with no blank tail feeding out after it.

The team's copy lives at `/rentals/<id>/receipt` with the print button and a link to send
the customer. The customer's own copy at `/r/<token>` is the same document, so the slip in
their hand and the page on their phone always agree. The QR code on the printed slip opens
that page — and scanning it at the counter opens the return.

## Products

A product can be deleted. What happens depends on whether it has a past: one nobody has
ever rented, bought or counted is removed outright, because a typo should be able to
disappear. One with history is archived instead — it leaves the catalogue and the scanner,
but the row stays so the stock ledger and every figure traced back to it still resolve.
Either way the rental lines, bills and receipts keep their own copy of the name and SKU,
so **nothing already printed changes**. Deleting is refused while units are still out on
rent.

## Sent back to supplier

Faulty stock goes back on the bill it arrived on, because that bill says who to chase and
what was paid per unit. Sending it back takes the units off the shelf straight away, so the
screen reads as an action with consequences rather than a note someone files, and the
quantity is capped at what is still left on the purchase line.

A supplier makes it good in three ways and often in more than one: replacements come back
as stock, a refund is money in, and a credit comes off what the business already owes them
— so it is recorded as a supplier payment with the method `credit` and pays down their
oldest bills exactly as cash would. Each can be recorded on its own, and a return that is
half replaced stays open for the rest. Closing one unsettled writes off what is left and
is kept deliberately quiet at the bottom of the dialog.

The figures above the list follow the same filters as the list. `outstanding` is summed in
Python rather than SQL, because it nets replacements, refunds and credits off the value;
only the open returns are totalled, which are the few rows a shop actually chases.

## Still to build

See `PLAN.md`. Everything in the plan is done.
