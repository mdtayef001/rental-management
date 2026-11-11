"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ProductFinder } from "@/components/product-finder"
import { useCurrency } from "@/components/session"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { useSetCustomerRate } from "@/lib/data/mutations"
import { useCustomerRates } from "@/lib/data/queries"
import { money } from "@/lib/format"
import { PLAN_LABEL, availablePlans, rateFor } from "@/lib/rental"
import type { ProductLookup, RentalPlan } from "@/lib/types"

const PER: Record<RentalPlan, string> = { daily: "a day", weekly: "a week", monthly: "a month", fixed: "fixed" }

/**
 * The prices agreed with one customer.
 *
 * Every product has a usual price. A company that rents all year has its own, and this is
 * where it is written down: renting to them starts from these, with no one having to
 * remember the deal. Anything not listed here is charged the usual price.
 */
export function CustomerPrices({ customerId, customerName, canEdit }: { customerId: string; customerName: string; canEdit: boolean }) {
  const currency = useCurrency()
  const { data: rates = [] } = useCustomerRates(customerId)
  const save = useSetCustomerRate(customerId)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ product: ProductLookup; plan: RentalPlan; rate: string } | null>(null)
  const [finding, setFinding] = useState(false)

  // Staff can't change prices, so an empty list is nothing they need to see.
  if (!canEdit && rates.length === 0) return null

  function start(product: ProductLookup) {
    const plan = availablePlans(product)[0]
    setDraft({ product, plan, rate: String(rateFor(product, plan) ?? "") })
  }

  async function lookUp(code: string) {
    setFinding(true)
    try {
      start(await request<ProductLookup>(`products/lookup/?code=${encodeURIComponent(code)}&rentable_only=1`))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't find that code.")
    } finally {
      setFinding(false)
    }
  }

  function close() {
    setDraft(null)
    setAdding(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Their prices</CardTitle>
        <CardDescription>
          {rates.length === 0
            ? `${customerName} pays the usual price for everything.`
            : "Used automatically when renting to them. Everything else is the usual price."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rates.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {rates.map((rate) => (
              <li key={rate.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{rate.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {rate.defaultRate != null ? `Usual ${money(rate.defaultRate, currency)} ${PER[rate.plan]}` : PLAN_LABEL[rate.plan]}
                  </p>
                </div>
                {canEdit ? (
                  <PriceBox
                    key={rate.rate}
                    value={rate.rate}
                    label={`${rate.productName} price ${PER[rate.plan]}`}
                    onSave={(value) => save.mutate({ product: rate.productId, plan: rate.plan, rate: value })}
                  />
                ) : (
                  <span className="font-medium tabular-nums">{money(rate.rate, currency)}</span>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Go back to the usual price for ${rate.productName}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ product: rate.productId, plan: rate.plan, rate: null })}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && !adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Set a price for a product
          </Button>
        )}

        {canEdit && adding && !draft && (
          <div className="space-y-2">
            <ProductFinder onCode={lookUp} onPick={start} busy={finding} autoFocus compact />
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
          </div>
        )}

        {canEdit && draft && (
          <form
            className="space-y-3 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault()
              const value = Number(draft.rate)
              if (draft.rate === "" || Number.isNaN(value) || value < 0) return
              save.mutate({ product: draft.product.id, plan: draft.plan, rate: value }, { onSuccess: close })
            }}
          >
            <p className="text-sm font-medium">{draft.product.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                step="any"
                autoFocus
                value={draft.rate}
                onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                className="h-9 w-28 tabular-nums"
                aria-label="Price"
              />
              <select
                value={draft.plan}
                onChange={(e) => setDraft({ ...draft, plan: e.target.value as RentalPlan })}
                className="h-9 rounded-md border bg-card px-2 text-sm"
                aria-label="Charged"
              >
                {availablePlans(draft.product).map((plan) => (
                  <option key={plan} value={plan}>
                    {PLAN_LABEL[plan]}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={save.isPending || draft.rate === ""}>
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
            </div>
            {rateFor(draft.product, draft.plan) != null && (
              <p className="text-xs text-muted-foreground">
                The usual price is {money(rateFor(draft.product, draft.plan), currency)} {PER[draft.plan]}.
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}

/** A price that saves when you leave the box or press Enter, and only if it changed. */
function PriceBox({ value, label, onSave }: { value: number; label: string; onSave: (value: number) => void }) {
  const [text, setText] = useState(String(value))

  function commit() {
    const next = Number(text)
    if (text === "" || Number.isNaN(next) || next < 0) return setText(String(value))
    if (next !== value) onSave(next)
  }

  return (
    <Input
      type="number"
      min={0}
      step="any"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-9 w-24 text-right tabular-nums"
      aria-label={label}
    />
  )
}
