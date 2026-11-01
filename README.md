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
purchases, suppliers, team, branches, activity, settings, the super admin's platform page,
and the public receipt a customer opens from their QR code.

## Still to build

See `PLAN.md`. Reporting with CSV export, and the supplier-returns screen (the API is
there). Everything else in the plan is done.
