"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/common"
import { ScanButton } from "@/components/scanner"
import { useCurrency } from "@/components/session"
import { useSaveProduct } from "@/lib/data/mutations"
import type { Product } from "@/lib/types"

/**
 * Add or edit a product.
 *
 * The rental rates are the point of this form, so they lead. A product needs at least one
 * rate before it can be rented — the server enforces that too, but saying so here saves a
 * round trip and explains why.
 */
export function ProductDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product
  onSaved?: (product: Product) => void
}) {
  const currency = useCurrency()
  const save = useSaveProduct(product?.id)
  const [form, setForm] = useState(() => ({
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    category: product?.category ?? "",
    unit: product?.unit ?? "pcs",
    description: product?.description ?? "",
    rentable: product?.rentable ?? true,
    rentDaily: product?.rentDaily ?? ("" as number | ""),
    rentWeekly: product?.rentWeekly ?? ("" as number | ""),
    rentMonthly: product?.rentMonthly ?? ("" as number | ""),
    deposit: product?.deposit ?? ("" as number | ""),
    replacementCost: product?.replacementCost ?? ("" as number | ""),
    sellable: product?.sellable ?? false,
    price: product?.price ?? ("" as number | ""),
    lowStockThreshold: product?.lowStockThreshold ?? ("" as number | ""),
  }))

  const text = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) }))

  const noRate = form.rentable && !form.rentDaily && !form.rentWeekly && !form.rentMonthly

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Empty money fields go as null, not 0: "no weekly rate" and "free by the week" are
    // different things, and the rate picker only offers plans that have a price.
    const blank = (v: number | "") => (v === "" ? null : v)
    save.mutate(
      {
        ...form,
        rentDaily: blank(form.rentDaily),
        rentWeekly: blank(form.rentWeekly),
        rentMonthly: blank(form.rentMonthly),
        deposit: form.deposit === "" ? 0 : form.deposit,
        replacementCost: form.replacementCost === "" ? 0 : form.replacementCost,
        price: form.price === "" ? 0 : form.price,
        lowStockThreshold: form.lowStockThreshold === "" ? 0 : form.lowStockThreshold,
      },
      { onSuccess: (saved) => (onSaved ? onSaved(saved) : onOpenChange(false)) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? `Edit ${product.name}` : "New product"}</DialogTitle>
          <DialogDescription>
            The barcode is what the scanner reads. Leave it empty for items with no printed label.
          </DialogDescription>
        </DialogHeader>

        <form id="product-form" className="space-y-6" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={form.name} onChange={text("name")} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-sku">SKU</Label>
              <Input id="p-sku" value={form.sku} onChange={text("sku")} required className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-barcode">Barcode</Label>
              <div className="flex gap-2">
                <Input
                  id="p-barcode"
                  value={form.barcode}
                  onChange={text("barcode")}
                  className="font-mono"
                  placeholder="Scan or type"
                />
                <ScanButton onScan={(code) => setForm((f) => ({ ...f, barcode: code }))} label="" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-category">Category</Label>
              <Input id="p-category" value={form.category} onChange={text("category")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-unit">Unit</Label>
              <Input id="p-unit" value={form.unit} onChange={text("unit")} placeholder="pcs, set, kg…" />
            </div>
          </div>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Renting</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.rentable}
                onChange={(e) => setForm((f) => ({ ...f, rentable: e.target.checked }))}
              />
              This can be rented out
            </label>

            {form.rentable && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Money id="p-daily" label={`Per day (${currency})`} value={form.rentDaily} onChange={num("rentDaily")} />
                  <Money id="p-weekly" label="Per week" value={form.rentWeekly} onChange={num("rentWeekly")} />
                  <Money id="p-monthly" label="Per month" value={form.rentMonthly} onChange={num("rentMonthly")} />
                </div>
                {noRate && (
                  <p className="text-sm text-warning-soft-foreground dark:text-warning">
                    Set at least one rate, or staff will have nothing to charge.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Money
                    id="p-deposit"
                    label="Suggested deposit, each"
                    value={form.deposit}
                    onChange={num("deposit")}
                    hint="Offered when renting out; staff can change it."
                  />
                  <Money
                    id="p-replacement"
                    label="Replacement cost, each"
                    value={form.replacementCost}
                    onChange={num("replacementCost")}
                    hint="Charged when one comes back broken or not at all."
                  />
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Selling and stock</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.sellable}
                onChange={(e) => setForm((f) => ({ ...f, sellable: e.target.checked }))}
              />
              This can also be sold outright
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              {form.sellable && <Money id="p-price" label="Sale price" value={form.price} onChange={num("price")} />}
              <div className="space-y-2">
                <Label htmlFor="p-low">Warn when stock drops to</Label>
                <Input
                  id="p-low"
                  type="number"
                  min={0}
                  value={form.lowStockThreshold}
                  onChange={num("lowStockThreshold")}
                  placeholder="Use the business default"
                  className="tabular-nums"
                />
              </div>
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="p-description">Description</Label>
            <Textarea id="p-description" value={form.description} onChange={text("description")} rows={2} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" disabled={save.isPending || !form.name.trim() || !form.sku.trim()}>
            {save.isPending && <Spinner />}
            {product ? "Save" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Money({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string
  label: string
  value: number | ""
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={0} step="0.01" value={value} onChange={onChange} placeholder="—" className="tabular-nums" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
