# Rental Management System — build plan

A multi-tenant rental management system for a single client, built fresh but porting the
proven pieces of `/home/tayef/code/friday` (Django 6 + DRF + Next.js 16).

## Decisions taken (2026-11-01)

| Question | Decision |
|---|---|
| Subscription / billing | **None.** No trials, no payment gateway, no lock-outs. A business is open until the super admin suspends it. |
| Warehouses / transfers | **None.** No warehouse type, no stock transfers, no stock requests. |
| Branches | **Branch model, one seeded per business, no screen.** There is nothing to manage: a business is created with one branch and the pickers never render. The model stays so a second location later needs no migration. |
| Rental shape | **Multi-item.** `Rental` + `RentalItem`, one receipt per rental, partial returns per item. |
| Stock tracking | **By quantity, fungible.** 1,000 sewing machines are one product with quantity 1,000; 100 go out on a rental. No per-unit serials. Tables leave room to add them later. |
| Purchasing | **Included.** Suppliers, purchases, supplier returns, supplier payments. |
| Codebase | **Fresh git repo**, deliberate port. |

## Stack

**Backend** — Django 6.1, DRF 3.18, SimpleJWT (15 min access / 12 h refresh, blacklist on
logout), `djangorestframework-camel-case` (camelCase on the wire, snake_case in Python),
PostgreSQL via `dj-database-url` (SQLite in dev), `django-cors-headers`, `python-dotenv`.

**Frontend** — Next.js 16 App Router, TypeScript (strict), Tailwind CSS v4, shadcn/ui on
Base UI, TanStack Query v5, `html5-qrcode` (camera scanning), `jose` (token verification in
the proxy), `zod` (form validation), `recharts` (reports), `date-fns`, `sonner` (toasts),
`lucide-react` (icons), `qrcode.react` (printing product QR labels).

## Security model (ported, unchanged in substance)

1. **Tokens never reach JavaScript.** Access + refresh live in `httpOnly`, `sameSite=lax`,
   `secure`-in-production cookies. The browser calls `/api/backend/*`, a Next.js route
   handler that attaches the token server-side.
2. **Three checks per request.** `proxy.ts` verifies the JWT signature and redirects before
   any page renders (and silently renews the access token from the refresh token); the page's
   DAL re-asks Django who the user is on every request, so a disabled account or changed role
   takes effect instantly; Django re-authorises every API call regardless.
4. **Tenant isolation at the queryset.** Every row carries `business`; a shared base viewset
   filters by `request.user.business` so a crafted id cannot reach another tenant's data.
5. **Role + per-person rights.** superadmin / owner / manager / staff, plus `canRent`,
   `canSell`, `canAddStock` per staff member, and owner-controlled manager permissions. The
   same rules exist in `roles.ts` and `permissions.py`, so a hidden route is also a refused one.
6. **Login throttling** (5/min), Django password validators, HSTS + SSL redirect +
   nosniff in production, no user-enumerating error messages.

## Performance rules

- No endpoint returns an unbounded list. Pagination (`?page=`, 50 default, 200 max) with
  server-side search and filtering.
- TanStack Query caches with a 30 s stale time; `keepPreviousData` so paging never blanks the
  screen; mutations invalidate only the collections they touched.
- Lists select only the columns they show, `select_related`/`prefetch_related` everywhere,
  and aggregates are computed in the database — never in Python over a full table.
- Scanner lookup is a single indexed query on `(business, barcode)` / `(business, sku)`.
- Heavy pages (reports, receipts) are code-split; the camera scanner is a dynamic import so
  its bundle only loads when someone opens it.

---

## Step-by-step build

Phases 0-5 are complete. See the README for what remains.

### Phase 0 — Scaffold
1. `git init`; `backend/` (uv, Django project `config`) and `frontend/` (create-next-app).
2. Apps: `accounts`, `catalog`, `rentals`, `purchasing`.
3. `settings.py`: env-driven, DRF + JWT + camelCase + pagination + throttling, logging.
4. Shared `apps/api.py`: string ids, tenant-scoped relation fields, `Pagination`.
5. Frontend: Tailwind v4, shadcn init, `providers.tsx` (QueryClient + theme + toasts).
6. `.env.example` on both sides, `README.md`, `.gitignore`.

### Phase 1 — Identity, tenancy, security
7. `Business` (name, settings JSON, suspended flag) — no billing fields.
8. `User` (email login, roles, branch assignment, per-person rights). No self sign-up.
9. `Branch` + auto-seeded default branch on business creation.
10. Auth endpoints: login (throttled), refresh, logout (blacklist), `me`.
11. `permissions.py`: `IsSuperAdmin`, `IsTenantMember`, role/module/permission gates.
12. Super admin API: create a business with its owner in one transaction, suspend, delete.
13. Owner API: create/edit/disable users, set their rights and branches.
14. Frontend auth: `proxy.ts`, `session.ts`, `dal.ts`, `/api/backend/[...path]`, login page,
    role-based home redirects, sidebar driven by `roles.ts`.

### Phase 2 — Catalog, stock, customers
15. `Product`: sku, barcode, name, category, unit, description, images-later, `rentDaily`,
    `rentWeekly`, `rentMonthly`, `defaultDeposit`, sale `price`, `cost`, low-stock alert,
    `rentable` flag.
16. `StockLevel` per (product, branch): `quantity` on hand, with `rentedOut` derived from
    open rental items so the two can never disagree.
17. Stock adjustments (add / remove / correct) with a reason, written to the activity log.
18. `GET /catalog/lookup/?code=` — one call that resolves a scanned barcode, QR payload or
    SKU to a product, with its availability per branch. The single endpoint the scanner uses.
19. Printable QR / barcode labels for products.
20. `Customer` (name, company, phone, email, address, ID/NID reference, notes) with per-customer
    history and outstanding balance.

### Phase 3 — Rentals (the core)
21. `Rental`: code, customer, branch, `startDate`, expected `dueDate`, status
    (`active` / `partly_returned` / `returned` / `overdue` is derived), deposit taken,
    note, `createdBy`.
22. `RentalItem`: product (name + rate frozen at rent-out time), `quantity`,
    `quantityReturned`, plan (daily / weekly / monthly / fixed), rate, line total.
    Stock leaves on create, comes back per return.
23. Quote engine shared by both sides: per-day bills days minus holidays, weekly/monthly bill
    every started period, fixed is a flat price. Identical arithmetic in `rentals/quote.py`
    and `lib/rental.ts`, covered by tests on both sides.
24. **Rent out by scanning**: scan → product resolved → add to a cart with quantity and plan →
    pick or create the customer → take a deposit → one rental, one receipt.
25. **Return by scanning — the disambiguation flow.** This is the feature the client asked for:
    - Scanning a *product* code finds every open rental item for that product. One match →
      straight to the return screen. Several → a chooser listing customer, rental code,
      quantity still out, days out and whether it is overdue.
    - Scanning a *rental receipt* QR opens that rental directly.
    - Searching a *customer* lists all their open rentals.
    - One endpoint, `POST /rentals/resolve-return/`, answers all three and always returns the
      same shape: `{ matches: [...], exact: <rental item id or null> }`.
    - Partial returns: 100 went out, 60 come back, 40 stay out and the rental becomes
      `partly_returned`.
26. Return settlement: days out counted per item, holidays deducted, late fees, damage
    charges, deposit applied, balance due or refundable — all shown before confirming.
27. Overdue tracking: `dueAt` indexed in the database so overdue rentals are a query, not a
    scan; dashboard badge and a dedicated overdue list.
28. **Receipts**: numbered per business (`R-000001`), rent-out receipt and return/settlement
    receipt, print-friendly A4 and 80 mm thermal layouts, a public tokenised link the customer
    can open on their phone, and a WhatsApp share link.

### Phase 4 — Purchasing
29. `Supplier`, `Purchase` + `PurchaseItem` (raises stock, moves product cost to a weighted
    average), payment status and due dates.
30. `SupplierReturn` (damaged stock back to the supplier) settled by replacement, refund or
    credit.
31. `SupplierPayment` with oldest-bill-first allocation, and a per-supplier statement.

### Phase 5 — Reporting, settings, hardening
32. Dashboard: out on rent now, due back today, overdue, revenue this month, top products,
    low stock — each a single aggregate query.
33. Reports with date ranges and CSV export: revenue by day/week/month, top products, top
    customers, and streamed CSV ledgers of rentals, returns and payments. Owner-only
    unless the owner switches "See profit and reports" on for managers. ✅
34. Activity log: who did what, when, filterable by person and action.
35. Business settings: currency, receipt note, rental defaults, late-fee rule, manager
    permissions, low-stock alert.
36. Tests: backend (tenant isolation, role gates, quote arithmetic, stock conservation under
    concurrent returns, the disambiguation resolver); frontend (quote parity, role rules).
37. Final pass: security review, query-count check on every list page, bundle check, README
    and deployment notes.
