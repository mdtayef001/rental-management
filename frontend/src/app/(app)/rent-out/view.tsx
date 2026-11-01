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
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useBranchScope, useCurrency, useCurrentUser, useSettings } from "@/components/session"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { type RentalLineInput, useRentOut } from "@/lib/data/mutations"
import { count, money, plural } from "@/lib/format"
import { PLAN_LABEL, availablePlans, quoteRental, rateFor } from "@/lib/rental"
import type { Customer, ProductLookup, RentalPlan } from "@/lib/types"
import { toast } from "sonner"

/** A product in the cart, with the terms staff chose for it. */
interface Line {
  product: ProductLookup
  quantity: number
  plan: RentalPlan
  rate: number
  deposit: number
}

/**
 * Renting out.
 *
 * A cart, because one customer taking a camera, a tripod and two lights is *one* rental
 * with one due date and one receipt — not three rentals to reconcile later. Scan items in,
 * set the terms per line, pick the customer, take a deposit, done.
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
  const [deposit, setDeposit] = useState<number | "">("")
  const [paid, setPaid] = useState<number | "">("")
  const [method, setMethod] = useState("cash")
  const [notes, setNotes] = useState("")
  const [adding, setAdding] = useState(false)

  const onHand = (product: ProductLookup) => product.stock[branchId] ?? 0

  /** Look a code up and put it in the cart. Scanning the same thing twice adds one more. */
  const addCode = useCallback(
    async (code: string) => {
      setAdding(true)
      try {
        const product = await request<ProductLookup>(
          `products/lookup/?code=${encodeURIComponent(code)}&rentable_only=1`,
        )
        setLines((current) => {
          const existing = current.findIndex((l) => l.product.id === product.id)
          if (existing >= 0) {
            // Already in the cart: scanning again means "one more of these".
            const next = [...current]
            const line = next[existing]
            const max = product.stock[branchId] ?? 0
            if (line.quantity >= max) {
              toast.warning(`Only ${max} ${product.name} are on the shelf.`)
              return current
            }
            next[existing] = { ...line, quantity: line.quantity + 1 }
            return next
          }
          if ((product.stock[branchId] ?? 0) <= 0) {
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
              rate: Number(rateFor(product, plan) ?? 0),
              deposit: Number(product.deposit ?? 0),
            },
          ]
        })
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Couldn't find that code.")
      } finally {
        setAdding(false)
      }
    },
    [branchId, settings.rentals.defaultPlan],
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
  const suggestedDeposit = lines.reduce((sum, l) => sum + l.deposit * l.quantity, 0)
  const depositValue = deposit === "" ? 0 : deposit

  const tooMany = lines.filter((l) => l.quantity > onHand(l.product))
  const needsCustomer = !customer && !(settings.permissions.staffWalkInRentals || user.role !== "staff")
  const canSubmit = lines.length > 0 && tooMany.length === 0 && !needsCustomer && !rentOut.isPending

  function submit() {
    // The clock is read here, in the handler, not during render.
    const dueAt = openEnded ? null : new Date(Date.now() + billedDays * 86_400_000).toISOString()
    const payload: RentalLineInput[] = lines.map((l) => ({
      product: l.product.id,
      quantity: l.quantity,
      plan: l.plan,
      rate: l.rate,
      deposit: l.deposit,
    }))
    rentOut.mutate(
      {
        customer: customer?.id ?? null,
        branch: branchId,
        lines: payload,
        dueAt,
        deposit: depositValue,
        paidAmount: paid === "" ? 0 : paid,
        paymentMethod: method,
        notes,
      },
      { onSuccess: (rental) => router.push(`/rentals/${rental.id}`) },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Rent out" description="Scan everything going out, then pick the customer.">
        {showPicker && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
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
              <CodeInput onSubmit={addCode} autoFocus busy={adding} placeholder="Scan or type a barcode / SKU" />
              <CameraScanner onDetected={addCode} />
            </CardContent>
          </Card>

          {lines.length === 0 ? (
            <EmptyState
              title="Nothing in the rental yet"
              description="Scan an item, or type its barcode or SKU above."
              icon={Package}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {plural(lines.length, "item")} · {count(lines.reduce((n, l) => n + l.quantity, 0))} units
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
              {needsCustomer && (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
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

              {user.canHandleDeposits && (
                <div className="space-y-1.5 border-t pt-3">
                  <Label htmlFor="deposit" className="text-xs">
                    Deposit taken
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="deposit"
                      type="number"
                      min={0}
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                      placeholder="0.00"
                      className="h-9 tabular-nums"
                    />
                    {suggestedDeposit > 0 && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setDeposit(suggestedDeposit)}>
                        {money(suggestedDeposit, currency)}
                      </Button>
                    )}
                  </div>
                  {settings.rentals.depositRequired && !depositValue && suggestedDeposit > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      These items suggest a {money(suggestedDeposit, currency)} deposit.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="paid" className="text-xs">
                  Rent paid up front
                </Label>
                <Input
                  id="paid"
                  type="number"
                  min={0}
                  value={paid}
                  onChange={(e) => setPaid(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  placeholder="0.00"
                  className="h-9 tabular-nums"
                />
              </div>

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
                : `Rent out ${count(lines.reduce((n, l) => n + l.quantity, 0))} units`}
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
  onChange,
  onRemove,
}: {
  line: Line
  days: number
  onHand: number
  currency: string
  onChange: (patch: Partial<Line>) => void
  onRemove: () => void
}) {
  const plans = availablePlans(line.product)
  const quote = quoteRental(line.plan, line.rate, days, line.quantity)
  const over = line.quantity > onHand

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
              // Swap in the product's own rate for the new plan, if it has one.
              onChange({ plan, rate: Number(rateFor(line.product, plan) ?? line.rate) })
            }}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
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
            onChange={(e) => onChange({ rate: Math.max(0, Number(e.target.value)) })}
            className="h-9 tabular-nums"
          />
        </div>
      </div>

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
