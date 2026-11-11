"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ChoiceInput, Spinner } from "@/components/common"
import { ScanButton } from "@/components/scanner"
import { useCurrency } from "@/components/session"
import { useSaveProduct } from "@/lib/data/mutations"
import { useCategories, useUnits } from "@/lib/data/queries"
import type { Product } from "@/lib/types"

/**
 * Add or edit a product.
 *
 * Everything is on the one sheet, in the order it is read off the item: what it is and its
 * codes, what it rents for, how many there are. Nothing is folded away.
 *
 * Required fields carry a red star. Leaving one empty says so under the field, as soon as
 * the field is left or Save is pressed, rather than leaving a greyed-out button to guess
 * at. The SKU is not one of them: it is numbered automatically when left empty.
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
  // What this shop has used before, so "Machinery" is picked rather than retyped (and
  // never ends up beside a "machinery" and a "Machinary").
  const categories = useCategories()
  const usedUnits = useUnits()
  const units = [...new Set([...usedUnits, "pcs", "set", "pair", "kg", "m"])]
  const [form, setForm] = useState(() => ({
    name: product?.name ?? "",
    rentDaily: product?.rentDaily ?? ("" as number | ""),
    rentWeekly: product?.rentWeekly ?? ("" as number | ""),
    rentMonthly: product?.rentMonthly ?? ("" as number | ""),
    openingStock: "" as number | "",
    replacementCost: product?.replacementCost || ("" as number | ""),
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? "",
    unit: product?.unit ?? "pcs",
    lowStockThreshold: product?.lowStockThreshold || ("" as number | ""),
    description: product?.description ?? "",
  }))
  // Which required fields have been visited; Save marks them all.
  const [touched, setTouched] = useState({ name: false, rates: false, stock: false })

  const text = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) }))
  const whole = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value))) }))

  const missing = {
    name: !form.name.trim(),
    rates: !form.rentDaily && !form.rentWeekly && !form.rentMonthly,
    stock: !product && form.openingStock === "",
  }
  const errors = {
    name: touched.name && missing.name ? "Enter the product's name." : undefined,
    rates: touched.rates && missing.rates ? "Enter at least one rent price." : undefined,
    stock: touched.stock && missing.stock ? "Enter how many you have. Use 0 if none yet." : undefined,
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (missing.name || missing.rates || missing.stock) {
      setTouched({ name: true, rates: true, stock: true })
      // Take the person to the first thing that needs filling in.
      const first = missing.name ? "p-name" : missing.rates ? "p-daily" : "p-stock"
      document.getElementById(first)?.focus()
      return
    }
    // Empty money fields go as null, not 0: "no weekly rate" and "free by the week" are
    // different things, and the rate picker only offers plans that have a price.
    const blank = (v: number | "") => (v === "" ? null : v)
    const { openingStock, ...fields } = form
    save.mutate(
      {
        ...fields,
        name: form.name.trim(),
        rentable: true,
        rentDaily: blank(form.rentDaily),
        rentWeekly: blank(form.rentWeekly),
        rentMonthly: blank(form.rentMonthly),
        replacementCost: form.replacementCost === "" ? 0 : form.replacementCost,
        lowStockThreshold: form.lowStockThreshold === "" ? 0 : form.lowStockThreshold,
        // Only a new product takes a count here; after that, stock changes on the stock screen.
        ...(!product && openingStock !== "" && { openingStock }),
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
            Fields marked <span className="text-destructive">*</span> are required.
          </DialogDescription>
        </DialogHeader>

        <form id="product-form" className="space-y-6" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="p-name">
                Name <Star />
              </Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={text("name")}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-required
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "p-name-error" : undefined}
                autoFocus
              />
              <FieldError id="p-name-error" message={errors.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-sku">SKU</Label>
              <Input
                id="p-sku"
                value={form.sku}
                onChange={text("sku")}
                className="font-mono"
                placeholder={product ? undefined : "Numbered for you if left empty"}
              />
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
              <ChoiceInput
                id="p-category"
                value={form.category}
                onChange={(category) => setForm((f) => ({ ...f, category }))}
                options={categories}
                placeholder="Choose or type a new one"
                noun="category"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-unit">Unit</Label>
              <ChoiceInput
                id="p-unit"
                value={form.unit}
                onChange={(unit) => setForm((f) => ({ ...f, unit }))}
                options={units}
                placeholder="pcs, set, kg…"
                noun="unit"
              />
            </div>
          </div>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">
              Rent ({currency}) <Star />
            </legend>
            <div
              className="grid gap-4 sm:grid-cols-3"
              // Leaving the group, not one box: tabbing from "per day" to "per week" is not
              // yet a decision to leave them all empty.
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setTouched((t) => ({ ...t, rates: true }))
              }}
            >
              <Money id="p-daily" label="Per day" value={form.rentDaily} onChange={num("rentDaily")} invalid={!!errors.rates} />
              <Money id="p-weekly" label="Per week" value={form.rentWeekly} onChange={num("rentWeekly")} invalid={!!errors.rates} />
              <Money id="p-monthly" label="Per month" value={form.rentMonthly} onChange={num("rentMonthly")} invalid={!!errors.rates} />
            </div>
            {errors.rates ? (
              <FieldError id="p-rates-error" message={errors.rates} />
            ) : (
              <p className="text-xs text-muted-foreground">At least one. Fill in only the ones you rent by.</p>
            )}
            <Money
              id="p-replacement"
              label="Replacement cost, each"
              value={form.replacementCost}
              onChange={num("replacementCost")}
              hint="Charged when one comes back broken or not at all."
              className="sm:max-w-xs"
            />
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Stock</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {!product && (
                <div className="space-y-2">
                  <Label htmlFor="p-stock">
                    How many you have <Star />
                  </Label>
                  <Input
                    id="p-stock"
                    type="number"
                    min={0}
                    step={1}
                    value={form.openingStock}
                    onChange={whole("openingStock")}
                    onBlur={() => setTouched((t) => ({ ...t, stock: true }))}
                    aria-required
                    aria-invalid={!!errors.stock}
                    aria-describedby={errors.stock ? "p-stock-error" : undefined}
                    placeholder="0"
                    className="tabular-nums"
                  />
                  <FieldError id="p-stock-error" message={errors.stock} />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="p-low">Warn when stock drops to</Label>
                <Input
                  id="p-low"
                  type="number"
                  min={0}
                  step={1}
                  value={form.lowStockThreshold}
                  onChange={whole("lowStockThreshold")}
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
          <Button type="submit" form="product-form" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {product ? "Save" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The mark on a required field. Read out as "required" rather than "asterisk". */
function Star() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  )
}

function Money({
  id,
  label,
  value,
  onChange,
  hint,
  invalid,
  className,
}: {
  id: string
  label: string
  value: number | ""
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  hint?: string
  invalid?: boolean
  className?: string
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={onChange}
        aria-invalid={invalid}
        placeholder="0.00"
        className="tabular-nums"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
