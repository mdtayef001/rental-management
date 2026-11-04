# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: counter staff, all day.** Staff run scan, rent-out and take-back continuously
through a shift. They work standing at a counter, frequently one-handed with a phone while
the other hand holds stock. Their job is to get stock out and back in correctly and fast,
and the cost of an error is charging the wrong customer. Staff land on `/scan` at login,
not on a dashboard.

**Secondary: the owner (and managers).** They check in once or twice a day to see what is
out, what is late, and what is owed, and to chase customers. They also do the work staff
cannot: purchasing, reports, team and settings. The dashboard is a glance for them, not a
workspace.

**Super admin.** A platform-level operator who creates and suspends businesses. Has no
business of their own and never sees tenant screens.

## Product Purpose

Rent counted stock out by scanning, take it back by scanning, and keep the books straight
for a multi-tenant rental business. A super admin creates businesses; each owner runs their
own team and their own stock. Success is that every unit that went out is accounted for,
every return closes the right rental, and the money owed at any moment is correct without
anybody doing arithmetic.

## Positioning

**Returns are resolved, never guessed.** Scanning on the Take back screen resolves three
different things through one endpoint (`POST /api/rentals/resolve-return/`): a product
barcode or SKU finds every open rental with that product still out; the QR code on a
customer's receipt finds that rental only; a customer search finds everything that customer
has out. When exactly one rental matches, the screen goes straight to it. When several match
— the same customer renting the same product twice, or two customers holding the same item —
it asks, showing who has it, which rental, how many units are still out, how many days out,
whether it is overdue, and what it would cost if it all came back now.

This is the requirement the client stated explicitly and the feature the whole system is
built around. The system never guesses, because guessing closes the wrong rental and charges
the wrong person.

**Returns are partial by default.** A hundred machines go out, sixty come back today, and
the remaining forty keep being charged until they do.

**Rent is earned on return.** Revenue is counted when items come back, because that is when
the length of the hire — and therefore the price — is finally known. Summing rentals by start
date would credit the wrong month.

## Operating Context

A single rental shop (the branch model exists and each business is seeded with exactly one;
the picker stays hidden until there are two, so a second location needs no migration).

At the counter:

- **Phone camera scanning** via `html5-qrcode` — the one-handed phone scene the interface is
  built around.
- **A USB / Bluetooth barcode gun** typing into a focused field. The scan path must survive
  machine-speed keyboard-wedge input and keep a persistent focus target; the camera
  viewfinder is one method, not the only one.
- **A thermal receipt printer.** The receipt is printed on a roll at handover and carries a
  QR code that is scanned back on return, so the print stylesheet and `ReceiptPaper`'s
  measured slip height are production requirements, not a nicety.

Chasing an overdue customer happens by phone call or WhatsApp from inside the app.

Offline operation was not raised as a requirement and is not assumed; requests are expected
to reach the server. Failure states must still be honest rather than optimistic, because a
rental that looks saved but is not charges nobody.

## Capabilities and Constraints

**In scope:** rentals (multi-item, partial returns, deposits, late and damage fees),
returns, customers, products, purchasing (suppliers, bills, supplier returns, supplier
payments), reports with CSV export, activity log, team management, business settings,
printed receipts, and a platform area for the super admin.

**Deliberately out of scope** (decided 2026-11-01, not oversights):

- **No subscription or billing of any kind.** No trials, no payment gateway, no lock-outs. A
  business is open until the super admin suspends it.
- **No warehouses and no stock transfers.**
- **No per-unit serial numbers.** Stock is counted and fungible: 1,000 sewing machines are
  one product with a quantity of 1,000, and 100 go out on a rental. Tables leave room to add
  serials later.

**Terminology:** *rental* (the agreement), *rental item* (one product line on it), *units
out* (quantity still with the customer), *take back* (the return flow), *sent back* (stock
returned to a supplier), *open* vs *overdue* vs *due today*.

**Roles and permissions.** Four roles — superadmin, owner, manager, staff. Managers hold
owner-granted permissions (`managerUsers`, `managerProducts`, `managerCustomers`,
`managerActivity`, `managerPurchases`, `managerProfit`); staff hold per-person rights
(`canRent`, `canTakeReturns`, `canSell`, `canAddStock`, `canHandleDeposits`). The owner's
first account is labelled "Owner" and any later owner-level account "Admin". The same rules
exist in `frontend/src/lib/auth/roles.ts` and `backend/apps/accounts/permissions.py`, because
hiding a link is not a security control.

**`managerProfit` gates cost and margin, not cash.** A manager must be able to see what a
customer owes in order to take a payment, and what deposits are held in order to return one.
They must not see what stock cost or what the business earns overall. Two consequences are
currently unresolved in the build and must not be settled silently:

1. The permission's label, "See profit and reports", describes it less accurately than
   "See costs, margins and reports".
2. The dashboard's "Rent earned this month" is turnover, not receivables, and is shown to a
   manager who does not hold `managerProfit`. By this rule it should be gated.

**Pricing is duplicated on purpose.** The rental quote exists in
`backend/apps/rentals/models.py` (`RentalItem.quote`) and `frontend/src/lib/rental.ts` with
mirrored test cases, so a customer sees the same price the server will charge. Change both
together or a suite fails.

**Language: English only, permanently.** No translation layer, no string extraction, no RTL.
Copy is written in plain English at the point of use. Currency is per-business and formatted
from a setting (the demo tenant uses ৳).

## Brand Commitments

**The product name is undecided.** "Rental Manager" is scaffolding — it appears in the title
template, the login mark and the sidebar subtitle, but it is not a client-approved name.
There is no logo and no wordmark. Future work must not treat it as a brand commitment, build
an identity around it, or invent a replacement; the client names it.

Each screen shows the tenant's own business name above the product descriptor.

## Evidence on Hand

- `README.md` — the product summary and the resolve-return table.
- `PLAN.md` — the running build plan and the decisions taken on 2026-11-01.
- `backend/apps/*/tests.py` and `frontend/src/lib/__tests__/rental.test.ts` — the mirrored
  pricing cases.
- `backend/manage.py seed_demo` — a demo business ("Dhaka Machine Rentals") with four
  accounts, realistic rentals, overdue items, suppliers and activity. This is **seeded demo
  data, not the client's real business**; the client's actual trading name, stock list,
  customers and figures are not in the repository.
- `/home/tayef/code/friday` — a separate reference project whose proven patterns are ported
  deliberately, never copied wholesale.

No testimonials, pricing, benchmarks, press, case studies or deployment claims exist. Future
work must not fabricate any.

## Product Principles

1. **Never guess whose stock this is.** When a scan is ambiguous, ask. Closing the wrong
   rental charges the wrong person, and that error is worse than an extra tap.
2. **The counter is the product.** Scan, rent out and take back carry the day's work;
   everything else is reporting on what they produced. Optimise them first.
3. **State the number in the unit the reader will act on.** Units still out, days late, money
   owed. A screen that makes someone do arithmetic has failed.
4. **Every figure leads to the rows behind it.** The next thing anyone does with a number
   they dislike is look at what is in it.
5. **Charge what is known, when it is known.** Rent is earned on return; a partial return
   keeps charging the units that are still out.

## Accessibility & Inclusion

The viewport permits zoom to 5× (`maximumScale: 5`) deliberately, because scanning happens
one-handed on a phone and zoom must not be locked away from people who need it. Controls are
sized as finger targets rather than mouse targets throughout. No further product-specific
standard has been established with the client.
