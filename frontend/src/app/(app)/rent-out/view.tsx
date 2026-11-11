"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CalendarClock, Package, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, PageHeader, Spinner } from "@/components/common"
import { CustomerPicker } from "@/components/customer-picker"
import { ProductFinder } from "@/components/product-finder"
import { useBranchScope, useCurrency, useCurrentUser, useSettings } from "@/components/session"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { type RentalLineInput, useRentOut } from "@/lib/data/mutations"
import { useCustomerRates } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"
import { PLAN_LABEL, availablePlans, quoteRental, rateFor } from "@/lib/rental"
import type { Customer, CustomerRate, ProductLookup, RentalPlan } from "@/lib/types"
import { toast } from "sonner"

/** A product in the cart, with the terms staff chose for it. */
interface Line {
  product: ProductLookup
  quantity: number
  plan: RentalPlan
  rate: number
  /** Staff typed this rate by hand, so picking a customer must not overwrite it. */
  rateTyped?: boolean
}

/** The price agreed with the chosen customer for a product and plan, if there is one. */
function agreedRate(rates: CustomerRate[] | undefined, productId: string, plan: RentalPlan) {
  return rates?.find((r) => r.productId === productId && r.plan === plan)?.rate
}

/** Where a line starts: the customer's own price, else the product's. */
function startingRate(rates: CustomerRate[] | undefined, product: ProductLookup, plan: RentalPlan, fallback = 0) {
  return Number(agreedRate(rates, product.id, plan) ?? rateFor(product, plan) ?? fallback)
}

/**
 * Renting out.
 *
 * A cart, because one customer taking a camera, a tripod and two lights is *one* rental
 * with one due date and one receipt — not three rentals to reconcile later. Scan items in,
 * set the terms per line, pick the customer, done. There is no deposit: a customer who
 * wants to pay ahead pays an advance, and the rent comes off it when the items come back.
 *
 * Each line starts at the price agreed with the chosen customer, or the product's own when
 * there is none, and can be changed for this rental — a different price for every company
 * without anyone having to remember it.
 *
 * The price is worked out with the same arithmetic the server will charge
 * (`quoteRental`, mirroring `RentalItem.quote`), so the figure staff quote is the figure
 * billed when the items come back.
 */
export function RentOutView() {
  const router = useRouter()
  const params = useSearchParams()
  const currency = useCurrency()
  const user = useCurrentUser()
  const settings = useSettings()
  const { branches, defaultBranchId, showPicker } = useBranchScope()
  const rentOut = useRentOut()

  const [openedAt] = useState(() => Date.now())
  const [branchId, setBranchId] = useState(defaultBranchId)
  const [lines, setLines] = useState<Line[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [days, setDays] = useState(7)
  const [openEnded, setOpenEnded] = useState(false)
  const [paid, setPaid] = useState<number | "">("")
  const [method, setMethod] = useState("cash")
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [adding, setAdding] = useState(false)
  const [remember, setRemember] = useState(false)
  const { data: rates } = useCustomerRates(customer?.id)

  // Picking (or changing) the customer re-prices the cart at their prices. Rates someone
  // typed by hand are left alone: they were a decision, not a default.
  const pricedFor = useRef<CustomerRate[] | undefined>(undefined)
  useEffect(() => {
    if (pricedFor.current === rates) return
    pricedFor.current = rates
    setLines((current) =>
      current.map((line) =>
        line.rateTyped ? line : { ...line, rate: startingRate(rates, line.product, line.plan, line.rate) },
      ),
    )
  }, [rates])

  const onHand = (product: ProductLookup) => product.stock[branchId] ?? 0

  /** Put a product in the cart. Adding the same thing twice means "one more of these". */
  const addProduct = useCallback(
    (product: ProductLookup) => {
      setLines((current) => {
        const existing = current.findIndex((l) => l.product.id === product.id)
        const max = product.stock[branchId] ?? 0
        if (existing >= 0) {
          const next = [...current]
          const line = next[existing]
          if (line.quantity >= max) {
            toast.warning(`Only ${max} ${product.name} are on the shelf.`)
            return current
          }
          next[existing] = { ...line, quantity: line.quantity + 1 }
          return next
        }
        if (max <= 0) {
          toast.warning(`No ${product.name} are on the shelf at this branch.`)
          return current
        }
        const plan = (availablePlans(product).includes(settings.rentals.defaultPlan)
          ? settings.rentals.defaultPlan
          : availablePlans(product)[0]) as RentalPlan
        return [
          ...current,
          {
            product,
            quantity: 1,
            plan,
            rate: startingRate(pricedFor.current, product, plan),
          },
        ]
      })
    },
    [branchId, settings.rentals.defaultPlan],
  )

  /** Look a scanned or typed code up and put it in the cart. */
  const addCode = useCallback(
    async (code: string) => {
      setAdding(true)
      try {
        addProduct(await request<ProductLookup>(`products/lookup/?code=${encodeURIComponent(code)}&rentable_only=1`))
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Couldn't find that code.")
      } finally {
        setAdding(false)
      }
    },
    [addProduct],
  )

  // Arriving from the scan screen with ?code=: put that item straight in the cart. The
  // "already handled" flag is a ref, not state — it only guards the effect and must never
  // cause a render of its own.
  const linked = params.get("code")
  const handledLink = useRef<string | null>(null)
  useEffect(() => {
    if (linked && handledLink.current !== linked) {
      handledLink.current = linked
      void addCode(linked)
    }
  }, [linked, addCode])

  function update(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const billedDays = openEnded ? 1 : Math.max(1, days)
  const estimate = lines.reduce((sum, l) => sum + quoteRental(l.plan, l.rate, billedDays, l.quantity).total, 0)

  const tooMany = lines.filter((l) => l.quantity > onHand(l.product))
  const needsCustomer = !customer && !(settings.permissions.staffWalkInRentals || user.role !== "staff")
  // Rates on this rental that differ from what the customer normally pays: worth offering
  // to remember, so the next rental starts from them.
  const mayRemember = !!customer && user.role !== "staff"
  const newPrices = lines.filter((l) => l.plan !== "fixed" && l.rate !== startingRate(rates, l.product, l.plan, l.rate))
  const canSubmit = lines.length > 0 && tooMany.length === 0 && !needsCustomer && !rentOut.isPending

  function submit() {
    // The clock is read here, in the handler, not during render.
    const dueAt = openEnded ? null : new Date(Date.now() + billedDays * 86_400_000).toISOString()
    const payload: RentalLineInput[] = lines.map((l) => ({
      product: l.product.id,
      quantity: l.quantity,
      plan: l.plan,
      rate: l.rate,
    }))
    rentOut.mutate(
      {
        customer: customer?.id ?? null,
        branch: branchId,
        lines: payload,
        dueAt,
        paidAmount: paid === "" ? 0 : paid,
        paymentMethod: method,
        paymentReference: method === "cash" ? "" : reference,
        notes,
        rememberRates: mayRemember && remember && newPrices.length > 0,
      },
      // Straight to the receipt: it is the thing to print or send while they are still here.
      { onSuccess: (rental) => router.push(`/rentals/${rental.id}/receipt`) },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Rent out" description="Scan everything going out, then pick the customer.">
        {showPicker && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 rounded-md border bg-card px-2 text-sm"
            aria-label="Branch"
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProductFinder onCode={addCode} onPick={addProduct} autoFocus busy={adding} />
            </CardContent>
          </Card>

          {lines.length === 0 ? (
            <EmptyState
              title="Nothing in the rental yet"
              description="Scan an item's QR code, or type its name or SKU above."
              icon={Package}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {plural(lines.length, "item")} · {plural(lines.reduce((n, l) => n + l.quantity, 0), "unit")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {lines.map((line, index) => (
                  <LineRow
                    key={line.product.id}
                    line={line}
                    days={billedDays}
                    onHand={onHand(line.product)}
                    currency={currency}
                    rates={rates}
                    customerName={customer?.name}
                    onChange={(patch) => update(index, patch)}
                    onRemove={() => setLines((c) => c.filter((_, i) => i !== index))}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerPicker
                value={customer}
                onChange={setCustomer}
                allowWalkIn={settings.permissions.staffWalkInRentals || user.role !== "staff"}
              />
              {mayRemember && newPrices.length > 0 && (
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span>
                    Remember {newPrices.length === 1 ? "this price" : "these prices"} for {customer?.name}
                    <span className="block text-xs text-muted-foreground">
                      Their next rental will start from {newPrices.length === 1 ? "it" : "them"}.
                    </span>
                  </span>
                </label>
              )}
              {needsCustomer && (
                <p className="mt-2 text-sm text-warning-soft-foreground dark:text-warning">
                  A customer is required for every rental, per your settings.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4" />
                Due back
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={openEnded ? "" : days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
                  disabled={openEnded}
                  className="h-10 w-24 tabular-nums"
                  aria-label="Days"
                />
                <span className="text-sm text-muted-foreground">days from now</span>
              </div>
              {settings.rentals.allowOpenEnded && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} />
                  No agreed return date
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                {openEnded
                  ? "Charged for however long it is actually out, with no overdue date."
                  : `Due ${new Date(openedAt + billedDays * 86_400_000).toLocaleDateString()}. The final price is worked out from the real days out.`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  Estimate{openEnded ? " (1 day)" : ` (${plural(billedDays, "day")})`}
                </span>
                <span className="font-semibold tabular-nums">{money(estimate, currency)}</span>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="paid" className="text-xs">
                  Paid in advance
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
                  {estimate > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPaid(estimate)}>
                      {money(estimate, currency)}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional. It is kept on the rental and the rent comes off it when the items come back; anything left
                  over is given back.
                </p>
              </div>

              {paid !== "" && paid > 0 && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="method" className="text-xs">
                      How
                    </Label>
                    <select
                      id="method"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                    >
                      <option value="cash">Cash</option>
                      <option value="mobile">Mobile banking</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank transfer</option>
                    </select>
                  </div>
                  {method !== "cash" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="reference" className="text-xs">
                        {method === "bank" ? "Cheque or transfer number" : "Transaction ID"}
                      </Label>
                      <Input
                        id="reference"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        maxLength={60}
                        className="h-9"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">
                  Note
                </Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Anything worth recording"
                />
              </div>
            </CardContent>
          </Card>

          {tooMany.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                Not enough stock for {tooMany.map((l) => l.product.name).join(", ")}. Reduce the quantity.
              </span>
            </div>
          )}

          <Button className="h-12 w-full text-base" disabled={!canSubmit} onClick={submit}>
            {rentOut.isPending && <Spinner />}
            {rentOut.isPending
              ? "Saving…"
              : lines.length === 0
                ? "Add something first"
                : `Rent out ${plural(lines.reduce((n, l) => n + l.quantity, 0), "unit")}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** One product in the cart: quantity, plan, rate, and what it comes to. */
function LineRow({
  line,
  days,
  onHand,
  currency,
  rates,
  customerName,
  onChange,
  onRemove,
}: {
  line: Line
  days: number
  onHand: number
  currency: string
  rates: CustomerRate[] | undefined
  customerName: string | undefined
  onChange: (patch: Partial<Line>) => void
  onRemove: () => void
}) {
  const plans = availablePlans(line.product)
  const quote = quoteRental(line.plan, line.rate, days, line.quantity)
  const over = line.quantity > onHand
  const usual = rateFor(line.product, line.plan)
  const agreed = agreedRate(rates, line.product.id, line.plan)
  // Says where the number in the Rate box came from, so nobody wonders why it isn't the
  // price on the label.
  const source =
    line.plan === "fixed"
      ? null
      : agreed !== undefined && line.rate === Number(agreed)
        ? `${customerName ?? "Customer"}'s price${usual != null ? ` · usual ${money(usual, currency)}` : ""}`
        : usual != null && line.rate === Number(usual)
          ? "Usual price"
          : usual != null
            ? `Changed · usual ${money(usual, currency)}`
            : null

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{line.product.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono text-xs">
              {line.product.sku}
            </Badge>
            <span>{count(onHand)} on the shelf</span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${line.product.name}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Quantity</Label>
          <Input
            type="number"
            min={1}
            max={onHand}
            value={line.quantity}
            onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value)) })}
            className={`h-9 tabular-nums ${over ? "border-destructive" : ""}`}
            aria-invalid={over}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Plan</Label>
          <select
            value={line.plan}
            onChange={(e) => {
              const plan = e.target.value as RentalPlan
              // Swap in the rate for the new plan: the customer's, else the product's.
              onChange({ plan, rate: startingRate(rates, line.product, plan, line.rate), rateTyped: false })
            }}
            className="h-9 w-full rounded-md border bg-card px-2 text-sm"
          >
            {plans.map((plan) => (
              <option key={plan} value={plan}>
                {PLAN_LABEL[plan]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Rate</Label>
          <Input
            type="number"
            min={0}
            value={line.rate}
            onChange={(e) => onChange({ rate: Math.max(0, Number(e.target.value)), rateTyped: true })}
            className="h-9 tabular-nums"
          />
        </div>
      </div>
      {source && <p className="text-xs text-muted-foreground">{source}</p>}

      <div className="flex items-baseline justify-between border-t pt-2 text-sm">
        <span className="text-muted-foreground">{quote.breakdown}</span>
        <span className="font-medium tabular-nums">{money(quote.total, currency)}</span>
      </div>

      {over && (
        <p className="text-xs text-destructive">
          Only {count(onHand)} are on the shelf at this branch.
        </p>
      )}
    </div>
  )
}
