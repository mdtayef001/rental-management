"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, Package, Receipt, Search, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, PageHeader, Spinner } from "@/components/common"
import { NotRecognised, NothingOut, ReturnChooser } from "@/components/return-chooser"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useCurrency, useCurrentUser, useSettings } from "@/components/session"
import { useResolveReturn, useTakeReturn } from "@/lib/data/mutations"
import { useCustomers, useDebounced } from "@/lib/data/queries"
import { count, dateTime, money, plural } from "@/lib/format"
import { quoteRental } from "@/lib/rental"
import type { ResolveReturnResult, ReturnCondition, ReturnMatch } from "@/lib/types"

/**
 * Taking items back.
 *
 * The flow the client asked for, in three steps:
 *
 *   1. **Find it.** Scan anything — a product barcode, the QR on the customer's receipt —
 *      or search by customer name. One endpoint resolves all of them.
 *   2. **Pick it, if there's a choice.** One match goes straight through. Several (the same
 *      customer renting the same thing twice, or two customers with the same item) show the
 *      chooser, because the system must never guess which rental is being closed.
 *   3. **Settle it.** How many came back, in what state, what's owed, deposit returned.
 *      Partial returns are normal: 60 of 100 back today, the other 40 keep running.
 */
export function TakeBackView() {
  const [step, setStep] = useState<"find" | "settle">("find")
  const [picked, setPicked] = useState<ReturnMatch | null>(null)
  const [result, setResult] = useState<ResolveReturnResult | null>(null)
  const [lastCode, setLastCode] = useState("")

  const resolve = useResolveReturn()

  function lookup(input: { code?: string; customer?: string; rental?: string }) {
    setLastCode(input.code ?? "")
    resolve.mutate(input, {
      onSuccess: (data) => {
        setResult(data)
        // Exactly one candidate: skip the chooser entirely. This is the common case and it
        // should cost no taps.
        if (data.exact) {
          const match = data.matches.find((m) => m.itemId === data.exact)
          if (match) {
            setPicked(match)
            setStep("settle")
          }
        }
      },
    })
  }

  function reset() {
    setPicked(null)
    setResult(null)
    setLastCode("")
    setStep("find")
    resolve.reset()
  }

  if (step === "settle" && picked) {
    return <SettleReturn match={picked} onDone={reset} onBack={() => setStep("find")} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Take back"
        description="Scan the item or the customer's receipt. If it's out with more than one person, you'll be asked which."
      />

      <FindPanel onLookup={lookup} busy={resolve.isPending} />

      {resolve.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Looking that up…
        </div>
      )}

      {resolve.isError && <ErrorState error={resolve.error} onRetry={() => resolve.reset()} />}

      {result && !resolve.isPending && (
        <Outcome result={result} code={lastCode} onPick={(m) => (setPicked(m), setStep("settle"))} onReset={reset} />
      )}
    </div>
  )
}

/** Step 1: scan, type, or search by customer. */
function FindPanel({
  onLookup,
  busy,
}: {
  onLookup: (input: { code?: string; customer?: string }) => void
  busy: boolean
}) {
  const [mode, setMode] = useState<"scan" | "customer">("scan")

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{mode === "scan" ? "Scan a code" : "Find the customer"}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setMode(mode === "scan" ? "customer" : "scan")}>
          {mode === "scan" ? (
            <>
              <User className="size-4" /> By customer
            </>
          ) : (
            <>
              <Package className="size-4" /> By code
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "scan" ? (
          <>
            {/* Typing first: a USB gun scanner needs nothing else, and it works when the
                camera is refused or missing. */}
            <CodeInput onSubmit={(code) => onLookup({ code })} autoFocus disabled={busy} />
            <p className="text-xs text-muted-foreground">
              Works with a product barcode, a SKU, or the QR code on the customer&apos;s receipt.
            </p>
            <CameraScanner onDetected={(code) => !busy && onLookup({ code })} />
          </>
        ) : (
          <CustomerSearch onPick={(id) => onLookup({ customer: id })} busy={busy} />
        )}
      </CardContent>
    </Card>
  )
}

function CustomerSearch({ onPick, busy }: { onPick: (id: string) => void; busy: boolean }) {
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 250)
  // Only customers who actually have something out: nobody else can be returning anything.
  const { data, isFetching } = useCustomers(
    { page: 1, search, hasOpenRentals: true, stats: true },
    { pageSize: 10, enabled: search.length > 1 },
  )

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Customer name or phone number"
          className="h-11 pl-9"
          autoFocus
          aria-label="Customer name or phone"
        />
      </div>

      {search.length > 1 && (
        <>
          {isFetching && !data && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Searching…
            </div>
          )}
          {data && data.results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No customer matching “{search}” has anything out on rent.
            </p>
          )}
          <ul className="divide-y rounded-md border">
            {data?.results.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(customer.id)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{customer.name}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {customer.phone || customer.company || "—"}
                    </div>
                  </div>
                  <Badge variant="secondary">{plural(customer.openRentalCount ?? 0, "rental")} out</Badge>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Step 2: what the lookup found — one, several, or nothing. */
function Outcome({
  result,
  code,
  onPick,
  onReset,
}: {
  result: ResolveReturnResult
  code: string
  onPick: (match: ReturnMatch) => void
  onReset: () => void
}) {
  const currency = useCurrency()

  // The code matched nothing at all.
  if (result.matchedBy === null) return <NotRecognised code={code} onReset={onReset} />

  // It matched something, but nothing is out with anyone.
  if (result.matches.length === 0) {
    if (result.matchedBy === "customer") {
      return (
        <EmptyState
          title="Nothing out with this customer"
          description="They have no items on rent at the moment, so there's nothing to take back."
          action={
            <Button variant="outline" onClick={onReset}>
              Find someone else
            </Button>
          }
          icon={User}
        />
      )
    }
    return <NothingOut productName={result.product?.name ?? result.rental?.code} onReset={onReset} />
  }

  return (
    <div className="space-y-4">
      {/* What was scanned, so staff can see the system understood them. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="gap-1.5">
          {result.matchedBy === "product" && <Package className="size-3.5" />}
          {result.matchedBy === "rental" && <Receipt className="size-3.5" />}
          {result.matchedBy === "customer" && <User className="size-3.5" />}
          {result.matchedBy === "product" && `Product: ${result.product?.name}`}
          {result.matchedBy === "rental" && `Rental ${result.rental?.code}`}
          {result.matchedBy === "customer" && `Customer: ${result.matches[0]?.customerName}`}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Start over
        </Button>
      </div>

      <ReturnChooser matches={result.matches} onPick={onPick} currency={currency} />
    </div>
  )
}

/** Step 3: how many came back, in what state, and what that costs. */
function SettleReturn({
  match,
  onDone,
  onBack,
}: {
  match: ReturnMatch
  onDone: () => void
  onBack: () => void
}) {
  const currency = useCurrency()
  const user = useCurrentUser()
  const settings = useSettings()
  const take = useTakeReturn()

  // Everything back is by far the usual case, so it's the default.
  const [quantity, setQuantity] = useState(match.quantityOut)
  const [condition, setCondition] = useState<ReturnCondition>("good")
  const [holidays, setHolidays] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState<number | "">("")
  const [depositBack, setDepositBack] = useState<number | "">("")
  const [method, setMethod] = useState("cash")
  const [note, setNote] = useState("")

  const qty = Math.min(Math.max(1, quantity || 1), match.quantityOut)
  const partial = qty < match.quantityOut

  // The same arithmetic the server will charge, so the figure on screen is the figure billed.
  const rent = quoteRental(match.plan, match.rate, match.daysOut, qty, holidays)
  const lateFee =
    match.overdueDays > 0 ? dailyValue(match) * (settings.rentals.lateFeeMultiplier || 0) * match.overdueDays * qty : 0
  const damage = condition === "good" ? 0 : match.replacementCost * qty
  const charges = Math.max(0, rent.total + lateFee + damage - (discount || 0))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <PageHeader
        title={`Taking back ${match.productName}`}
        description={`${match.customerName} · ${match.rentalCode} · out ${plural(match.daysOut, "day")}`}
      />

      {match.isOverdue && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          This rental is <strong>{plural(match.overdueDays, "day")} overdue.</strong>{" "}
          {settings.rentals.lateFeeMultiplier > 0
            ? "A late fee is included below."
            : "No late fee is charged, per your settings."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What came back</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="quantity">
                How many of the {count(match.quantityOut)} {match.productSku && `(${match.productSku})`} came back?
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={match.quantityOut}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="h-11 w-32 text-lg tabular-nums"
                />
                <Button type="button" variant="outline" onClick={() => setQuantity(match.quantityOut)}>
                  All {count(match.quantityOut)}
                </Button>
              </div>
              {partial && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  {count(match.quantityOut - qty)} will stay out with {match.customerName}, and keep being charged
                  until they come back.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { value: "good", label: "Good", hint: "Back on the shelf" },
                    { value: "damaged", label: "Damaged", hint: "Charged for replacement" },
                    { value: "lost", label: "Not returned", hint: "Charged for replacement" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCondition(option.value)}
                    className={`rounded-md border p-3 text-left text-sm transition ${
                      condition === option.value ? "border-primary bg-accent" : "hover:bg-accent/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {condition === option.value && <Check className="size-3.5" />}
                      {option.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{option.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {match.plan === "daily" && (
              <div className="space-y-2">
                <Label htmlFor="holidays">Days not charged for</Label>
                <Input
                  id="holidays"
                  type="number"
                  min={0}
                  max={match.daysOut}
                  value={holidays}
                  onChange={(e) => setHolidays(Math.max(0, Number(e.target.value)))}
                  className="h-11 w-32 tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  For days the shop was shut or the item was faulty. Only applies to per-day pricing.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth recording about this return"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What&apos;s owed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label={`Rent · ${rent.breakdown}`} value={money(rent.total, currency)} />
              {lateFee > 0 && (
                <Row label={`Late fee · ${plural(match.overdueDays, "day")}`} value={money(lateFee, currency)} warn />
              )}
              {damage > 0 && (
                <Row
                  label={`${condition === "lost" ? "Not returned" : "Damage"} · ${count(qty)} × ${money(match.replacementCost, currency)}`}
                  value={money(damage, currency)}
                  warn
                />
              )}

              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="discount" className="text-xs">
                  Discount
                </Label>
                <Input
                  id="discount"
                  type="number"
                  min={0}
                  value={discount || ""}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                  placeholder="0.00"
                  className="h-9 tabular-nums"
                />
              </div>

              <div className="flex items-baseline justify-between border-t pt-3 font-semibold">
                <span>Total</span>
                <span className="text-lg tabular-nums">{money(charges, currency)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="paid" className="text-xs">
                  Taken now
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="paid"
                    type="number"
                    min={0}
                    value={paid}
                    onChange={(e) => setPaid(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                    placeholder="0.00"
                    className="h-9 tabular-nums"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setPaid(charges)}>
                    Full
                  </Button>
                </div>
              </div>

              {user.canHandleDeposits && match.deposit > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="deposit" className="text-xs">
                    Deposit given back
                  </Label>
                  <Input
                    id="deposit"
                    type="number"
                    min={0}
                    value={depositBack}
                    onChange={(e) =>
                      setDepositBack(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))
                    }
                    placeholder="0.00"
                    className="h-9 tabular-nums"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="method" className="text-xs">
                  How
                </Label>
                <select
                  id="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="mobile">Mobile banking</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank transfer</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Button
            className="h-12 w-full text-base"
            disabled={take.isPending}
            onClick={() =>
              take.mutate(
                {
                  rentalId: match.rentalId,
                  lines: [{ item: match.itemId, quantity: qty, condition, holidays, note }],
                  discount: discount || 0,
                  paidAmount: paid === "" ? 0 : paid,
                  depositRefunded: depositBack === "" ? 0 : depositBack,
                  paymentMethod: method,
                  note,
                },
                { onSuccess: onDone },
              )
            }
          >
            {take.isPending && <Spinner />}
            {take.isPending ? "Recording…" : `Take back ${count(qty)} and charge ${money(charges, currency)}`}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Out {dateTime(match.startedAt)} ·{" "}
            <Link href={`/rentals/${match.rentalId}`} className="underline">
              See the whole rental
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={warn ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/** A line's value per day, used to show the late fee. Mirrors `late_fee_for` in Django. */
function dailyValue(match: ReturnMatch) {
  if (match.plan === "weekly") return match.rate / 7
  if (match.plan === "monthly") return match.rate / 30
  return match.rate
}
