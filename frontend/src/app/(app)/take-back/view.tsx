"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Minus,
  Package,
  Plus,
  Receipt,
  User,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, PageHeader, Pill, Spinner } from "@/components/common"
import { NotRecognised, NothingOut, ReturnChooser } from "@/components/return-chooser"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useCurrency, useSettings } from "@/components/session"
import { useResolveReturn, useTakeReturn } from "@/lib/data/mutations"
import { useCustomers, useDebounced, useProductSearch, useRentals } from "@/lib/data/queries"
import { count, dateTime, dueLabel, money, plural, round2 } from "@/lib/format"
import { quoteRental } from "@/lib/rental"
import { cn } from "@/lib/utils"
import type { ResolveReturnResult, ReturnCondition, ReturnMatch } from "@/lib/types"

type Lookup = { code?: string; customer?: string; rental?: string }
type Step = "find" | "choose" | "settle" | "done"
interface Done {
  match: ReturnMatch
  quantity: number
  code: string
  stillOut: number
}

/**
 * Taking items back.
 *
 * Three steps, always shown across the top so nobody is lost:
 *
 *   1. **Find.** One box takes anything — a scanned barcode, the QR on a receipt, or a few
 *      letters of a customer's or product's name — and everything that is out on rent is
 *      listed underneath, so the rental can simply be picked with no typing at all.
 *   2. **Choose**, only if there is a choice. One match goes straight through. Several (the
 *      same customer renting the same thing twice, or two customers with the same item)
 *      show the chooser, because the system must never guess which rental is being closed.
 *   3. **Settle.** How many came back, in what state, and what is owed after any advance.
 *      Partial returns are normal: 60 of 100 back today, the other 40 keep running.
 *
 * It ends on a confirmation with the next things staff usually do, rather than dropping
 * silently back to an empty search box.
 */
export function TakeBackView() {
  const [step, setStep] = useState<Step>("find")
  const [picked, setPicked] = useState<ReturnMatch | null>(null)
  const [result, setResult] = useState<ResolveReturnResult | null>(null)
  const [lastCode, setLastCode] = useState("")
  const [done, setDone] = useState<Done | null>(null)

  const resolve = useResolveReturn()

  function lookup(input: Lookup) {
    setLastCode(input.code ?? "")
    setDone(null)
    resolve.mutate(input, {
      onSuccess: (data) => {
        setResult(data)
        // Exactly one candidate: skip the chooser entirely. This is the common case and it
        // should cost no taps.
        const exact = data.exact ? data.matches.find((m) => m.itemId === data.exact) : undefined
        if (exact) {
          setPicked(exact)
          setStep("settle")
        } else {
          setPicked(null)
          setStep("choose")
        }
      },
    })
  }

  function reset() {
    setPicked(null)
    setResult(null)
    setLastCode("")
    setDone(null)
    setStep("find")
    resolve.reset()
  }

  // Whether stepping back from "settle" has a chooser to land on, or only the search.
  const hadChoice = !!result && result.matches.length > 1

  return (
    <div className="space-y-5">
      <PageHeader title="Take back" />
      <Steps
        step={step}
        hadChoice={hadChoice}
        onFind={reset}
        onChoose={hadChoice && step === "settle" ? () => setStep("choose") : undefined}
      />

      {step === "find" && (
        <>
          <FindPanel onLookup={lookup} busy={resolve.isPending} />
          {resolve.isError && <ErrorState error={resolve.error} onRetry={() => resolve.reset()} />}
        </>
      )}

      {step === "choose" && result && (
        <Outcome result={result} code={lastCode} onPick={(m) => (setPicked(m), setStep("settle"))} onReset={reset} />
      )}

      {step === "settle" && picked && (
        <SettleReturn
          // A different line is a different form: nothing typed for one carries to the next.
          key={picked.itemId}
          match={picked}
          onBack={hadChoice ? () => setStep("choose") : reset}
          onDone={(finished) => {
            setDone(finished)
            setStep("done")
          }}
        />
      )}

      {step === "done" && done && (
        <DonePanel
          done={done}
          busy={resolve.isPending}
          onAgain={reset}
          onSameCustomer={done.match.customerId ? () => lookup({ customer: done.match.customerId! }) : undefined}
        />
      )}
    </div>
  )
}

/** Where you are in the return, and the way back to an earlier step. */
function Steps({
  step,
  hadChoice,
  onFind,
  onChoose,
}: {
  step: Step
  hadChoice: boolean
  onFind: () => void
  onChoose?: () => void
}) {
  const order: Step[] = ["find", "choose", "settle", "done"]
  const at = order.indexOf(step)
  const items: { id: Step; label: string; onClick?: () => void }[] = [
    { id: "find", label: "Find", onClick: step === "find" ? undefined : onFind },
    { id: "choose", label: "Choose", onClick: onChoose },
    { id: "settle", label: "Settle" },
  ]
  return (
    <ol className="flex items-center gap-1 text-sm" aria-label="Steps">
      {items.map((item, index) => {
        const here = item.id === step
        const passed = order.indexOf(item.id) < at
        // "Choose" was never shown when the scan had only one match.
        const skipped = item.id === "choose" && passed && !hadChoice
        const body = (
          <>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                here && "bg-primary text-primary-foreground",
                passed && !here && "bg-success-soft text-success-soft-foreground",
                !here && !passed && "bg-muted text-muted-foreground",
              )}
            >
              {passed ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn(here ? "font-semibold" : "text-muted-foreground", skipped && "line-through")}>
              {item.label}
            </span>
          </>
        )
        return (
          <li key={item.id} className="flex items-center gap-1" aria-current={here ? "step" : undefined}>
            {index > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-2 px-1.5 py-1">{body}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Step 1. One box for everything, and the list of what is out underneath it.
 *
 * A scanner sends a whole code and Enter, which is looked up exactly. Someone typing a
 * name gets matching customers and products as they type and taps one. And someone who
 * would rather not type picks the rental straight off the list.
 */
function FindPanel({ onLookup, busy }: { onLookup: (input: Lookup) => void; busy: boolean }) {
  const [text, setText] = useState("")
  const [camera, setCamera] = useState(false)
  const typed = text.trim()
  const settled = useDebounced(typed, 200)

  // Only customers who actually have something out: nobody else can be returning anything.
  const customers = useCustomers(
    { page: 1, search: settled, hasOpenRentals: true, stats: true },
    { pageSize: 5, enabled: settled.length > 0 },
  )
  const products = useProductSearch(typed, { enabled: typed.length > 0 })
  const people = typed ? (customers.data?.results ?? []) : []
  const items = typed ? (products.data ?? []).slice(0, 5) : []
  const searching = typed.length > 0 && (customers.isFetching || products.isFetching)

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3">
          <CodeInput
            value={text}
            onChange={setText}
            onSubmit={(code) => {
              // Enter on a name with exactly one match means "that one"; anything else is
              // treated as a code, which is what a scanner sends.
              const exact = items.find((p) => [p.sku, p.barcode].includes(code))
              if (!exact && people.length === 1 && items.length === 0) onLookup({ customer: people[0].id })
              else if (!exact && items.length === 1 && people.length === 0) onLookup({ code: items[0].sku })
              else onLookup({ code })
            }}
            busy={busy}
            autoFocus
            placeholder="Scan a code, or type a customer or product name"
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => setCamera((on) => !on)}
              aria-pressed={camera}
              aria-label={camera ? "Close camera" : "Scan with the camera"}
              className="h-11 shrink-0"
            >
              {camera ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
              <span className="hidden sm:inline">{camera ? "Close camera" : "Camera"}</span>
            </Button>
          </CodeInput>

          {camera && (
            <div className="max-w-sm">
              <CameraScanner
                onDetected={(code) => {
                  if (!busy) onLookup({ code })
                }}
              />
            </div>
          )}

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Looking that up…
            </p>
          )}

          {typed && (people.length > 0 || items.length > 0) && (
            <ul className="divide-y overflow-hidden rounded-lg border" aria-label="Matches">
              {people.map((customer) => (
                <Suggestion
                  key={customer.id}
                  icon={User}
                  title={customer.name}
                  sub={customer.phone || customer.company}
                  end={`${plural(customer.openRentalCount ?? 0, "rental")} out`}
                  disabled={busy}
                  onClick={() => onLookup({ customer: customer.id })}
                />
              ))}
              {items.map((product) => (
                <Suggestion
                  key={product.id}
                  icon={Package}
                  title={product.name}
                  sub={product.sku}
                  end="Product"
                  disabled={busy}
                  onClick={() => onLookup({ code: product.sku })}
                />
              ))}
            </ul>
          )}
          {typed && !searching && people.length === 0 && items.length === 0 && (
            <p className="text-sm text-muted-foreground">No name matches “{typed}”. Press Enter to look it up as a code.</p>
          )}
        </CardContent>
      </Card>

      {!typed && <OutNow onPick={(rental) => onLookup({ rental })} busy={busy} />}
    </div>
  )
}

function Suggestion({
  icon: Icon,
  title,
  sub,
  end,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub?: string
  end: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{end}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

/** Everything out on rent, most overdue first: the return is usually one tap from here. */
function OutNow({ onPick, busy }: { onPick: (rentalId: string) => void; busy: boolean }) {
  const [onlyLate, setOnlyLate] = useState(false)
  const { data, isLoading } = useRentals(
    { page: 1, status: onlyLate ? "overdue" : "open", sort: "due" },
    { pageSize: 50 },
  )
  // Soonest due first, and the ones with no return date after everything that has one.
  const rentals = [...(data?.results ?? [])].sort(
    (a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity),
  )

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-semibold">
          Out on rent now
          {data && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{count(data.count)}</span>}
        </h2>
        <div className="flex gap-1">
          <Button size="sm" variant={onlyLate ? "outline" : "default"} onClick={() => setOnlyLate(false)}>
            All
          </Button>
          <Button size="sm" variant={onlyLate ? "default" : "outline"} onClick={() => setOnlyLate(true)}>
            Overdue
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </p>
      ) : rentals.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {onlyLate ? "Nothing is overdue." : "Nothing is out on rent."}
        </p>
      ) : (
        // Ten rows tall, then it scrolls, so the search box above never leaves the screen.
        <ul className="max-h-[35rem] divide-y overflow-y-auto rounded-lg border bg-card">
          {rentals.map((rental) => (
            <li key={rental.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(rental.id)}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{rental.customerName || "Walk-in"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{rental.code}</span> · {plural(rental.unitsOut, "unit")} out
                  </span>
                </span>
                {rental.isOverdue ? (
                  <Pill tone="danger">
                    <AlertTriangle className="size-3" />
                    {plural(rental.daysLate, "day")} overdue
                  </Pill>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{dueLabel(rental.dueAt)}</span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  onDone: (done: Done) => void
  onBack: () => void
}) {
  const currency = useCurrency()
  const settings = useSettings()
  const take = useTakeReturn()

  // Everything back is by far the usual case, so it's the default.
  const [quantity, setQuantity] = useState<number | "">(match.quantityOut)
  const [condition, setCondition] = useState<ReturnCondition>("good")
  const [holidays, setHolidays] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState<number | "">("")
  const [givenBack, setGivenBack] = useState<number | "">("")
  const [method, setMethod] = useState("cash")
  const [note, setNote] = useState("")
  const [extras, setExtras] = useState(false)

  const qty = Math.min(Math.max(1, Math.round(quantity || 1)), match.quantityOut)
  const partial = qty < match.quantityOut

  // The same arithmetic the server will charge, so the figure on screen is the figure billed.
  const rent = quoteRental(match.plan, match.rate, match.daysOut, qty, holidays)
  const lateFee =
    match.overdueDays > 0
      ? round2(dailyValue(match) * (settings.rentals.lateFeeMultiplier || 0) * match.overdueDays * qty)
      : 0
  const damage = condition === "good" ? 0 : match.replacementCost * qty
  const charges = round2(Math.max(0, rent.total + lateFee + damage - (discount || 0)))
  // What they paid in advance is used first; only the rest is asked for now.
  const credit = match.rentalCredit
  const fromAdvance = Math.min(credit, charges)
  const toPay = round2(charges - fromAdvance)
  const leftOver = round2(credit - fromAdvance)

  return (
    <div className="space-y-4">
      {/* What is being taken back, so it can be checked against the person at the counter. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-lg font-semibold">{match.productName}</p>
            <p className="truncate text-sm text-muted-foreground">
              {match.customerName} · <span className="font-mono">{match.rentalCode}</span> · out{" "}
              {plural(match.daysOut, "day")}
            </p>
          </div>
          {match.isOverdue && (
            <Pill tone="danger">
              <AlertTriangle className="size-3" />
              {plural(match.overdueDays, "day")} overdue
            </Pill>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What came back</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="quantity">How many, of the {count(match.quantityOut)} out</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label="One fewer"
                  disabled={qty <= 1}
                  onClick={() => setQuantity(qty - 1)}
                >
                  <Minus className="size-4" />
                </Button>
                <Input
                  id="quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  max={match.quantityOut}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                  onBlur={() => setQuantity(qty)}
                  className="h-11 w-24 text-center text-lg font-semibold tabular-nums"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label="One more"
                  disabled={qty >= match.quantityOut}
                  onClick={() => setQuantity(qty + 1)}
                >
                  <Plus className="size-4" />
                </Button>
                {match.quantityOut > 1 && (
                  <Button
                    type="button"
                    variant={partial ? "outline" : "secondary"}
                    className="h-11"
                    onClick={() => setQuantity(match.quantityOut)}
                  >
                    All {count(match.quantityOut)}
                  </Button>
                )}
              </div>
              {partial && (
                <p className="text-sm text-warning-soft-foreground dark:text-warning">
                  {count(match.quantityOut - qty)} will stay out and keep being charged.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: "good", label: "Good" },
                    { value: "damaged", label: "Damaged" },
                    { value: "lost", label: "Not returned" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={condition === option.value}
                    onClick={() => setCondition(option.value)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-medium transition focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      condition === option.value
                        ? option.value === "good"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-destructive bg-destructive-soft text-destructive-soft-foreground"
                        : "hover:bg-accent/60",
                    )}
                  >
                    {condition === option.value && <Check className="size-3.5" />}
                    {option.label}
                  </button>
                ))}
              </div>
              {condition !== "good" && (
                <p className="text-sm text-muted-foreground">
                  Charged {money(match.replacementCost, currency)} each to replace.
                </p>
              )}
            </div>

            {/* The things most returns never need, one tap away rather than always in the way. */}
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setExtras((on) => !on)}
                aria-expanded={extras}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium"
              >
                Days off, discount or a note
                <ChevronDown className={cn("size-4 shrink-0 transition-transform", extras && "rotate-180")} />
              </button>
              {extras && (
                <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
                  {match.plan === "daily" && (
                    <div className="space-y-2">
                      <Label htmlFor="holidays">Days not charged</Label>
                      <Input
                        id="holidays"
                        type="number"
                        min={0}
                        step={1}
                        max={match.daysOut}
                        value={holidays || ""}
                        onChange={(e) => setHolidays(Math.min(match.daysOut, Math.max(0, Number(e.target.value))))}
                        placeholder="0"
                        className="tabular-nums"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="discount">Discount ({currency})</Label>
                    <Input
                      id="discount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={discount || ""}
                      onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                      placeholder="0.00"
                      className="tabular-nums"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="note">Note</Label>
                    <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-base">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              <Row label={`Rent · ${rent.breakdown}`} value={money(rent.total, currency)} />
              {lateFee > 0 && (
                <Row label={`Late fee · ${plural(match.overdueDays, "day")}`} value={money(lateFee, currency)} warn />
              )}
              {damage > 0 && (
                <Row label={condition === "lost" ? "Not returned" : "Damage"} value={money(damage, currency)} warn />
              )}
              {discount > 0 && <Row label="Discount" value={`− ${money(discount, currency)}`} />}
              {credit > 0 && <Row label="Paid in advance" value={`− ${money(fromAdvance, currency)}`} />}
              <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
                <span>To pay now</span>
                <span className="font-heading text-2xl tabular-nums">{money(toPay, currency)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paid">Taken now ({currency})</Label>
              <div className="flex gap-2">
                <Input
                  id="paid"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  placeholder="0.00"
                  className="h-11 text-base tabular-nums"
                />
                <Button
                  type="button"
                  variant={paid === toPay && toPay > 0 ? "secondary" : "outline"}
                  className="h-11 shrink-0"
                  onClick={() => setPaid(toPay)}
                  disabled={toPay === 0}
                >
                  Full
                </Button>
              </div>
              {toPay > 0 && (paid === "" ? 0 : paid) < toPay && (
                <p className="text-xs text-muted-foreground">
                  {money(round2(toPay - (paid === "" ? 0 : paid)), currency)} will stay owed on the rental.
                </p>
              )}
            </div>

            {leftOver > 0 && (
              <div className="space-y-2">
                <Label htmlFor="given-back">Given back from their advance</Label>
                <div className="flex gap-2">
                  <Input
                    id="given-back"
                    type="number"
                    min={0}
                    step="0.01"
                    max={leftOver}
                    value={givenBack}
                    onChange={(e) =>
                      setGivenBack(e.target.value === "" ? "" : Math.min(leftOver, Math.max(0, Number(e.target.value))))
                    }
                    placeholder="0.00"
                    className="h-11 tabular-nums"
                  />
                  <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setGivenBack(leftOver)}>
                    All {money(leftOver, currency)}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Paid by</Label>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={method === option.value}
                    onClick={() => setMethod(option.value)}
                    className={cn(
                      "min-h-10 rounded-md border px-2 text-sm font-medium transition focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      method === option.value ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent/60",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

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
                    refunded: leftOver > 0 && givenBack !== "" ? givenBack : 0,
                    paymentMethod: method,
                    note,
                  },
                  {
                    onSuccess: ({ return: taken, rental }) =>
                      onDone({ match, quantity: qty, code: taken.code, stillOut: rental.unitsOut }),
                  },
                )
              }
            >
              {take.isPending ? <Spinner /> : <Check className="size-4" />}
              {take.isPending ? "Recording…" : `Take back ${count(qty)}`}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Out {dateTime(match.startedAt)} ·{" "}
              <Link href={`/rentals/${match.rentalId}`} className="underline">
                See the rental
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mobile", label: "Mobile banking" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
]

/** The return is recorded: say so, and offer what usually comes next. */
function DonePanel({
  done,
  busy,
  onAgain,
  onSameCustomer,
}: {
  done: Done
  busy: boolean
  onAgain: () => void
  onSameCustomer?: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <CircleCheck className="size-12 text-success" />
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">
            {count(done.quantity)} × {done.match.productName} taken back
          </h2>
          <p className="text-sm text-muted-foreground">
            From {done.match.customerName} · <span className="font-mono">{done.code}</span>
            {done.stillOut > 0 && ` · ${plural(done.stillOut, "unit")} still out on this rental`}
          </p>
        </div>
        <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
          <Button className="h-11" onClick={onAgain} autoFocus>
            Take back another
          </Button>
          {onSameCustomer && (
            <Button variant="outline" className="h-11" onClick={onSameCustomer} disabled={busy}>
              {busy ? <Spinner /> : <User className="size-4" />}
              More from this customer
            </Button>
          )}
          <ButtonLink variant="outline" className="h-11" href={`/rentals/${done.match.rentalId}/receipt`}>
            <Receipt className="size-4" />
            Receipt
          </ButtonLink>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={warn ? "text-warning-soft-foreground dark:text-warning" : "text-muted-foreground"}>{label}</span>
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
