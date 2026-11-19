"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/common"
import { useAdjustStock } from "@/lib/data/mutations"
import { count } from "@/lib/format"
import type { Product } from "@/lib/types"
import { msg, t } from "@/lib/i18n"

const REASONS = [
  { value: "adjustment", label: msg("Correcting a miscount"), hint: msg("The shelf never matched the system.") },
  { value: "damage", label: msg("Damaged or written off"), hint: msg("Broken beyond use.") },
  { value: "lost", label: msg("Lost or stolen"), hint: msg("Gone, and not coming back.") },
] as const

/**
 * Correcting a shelf count.
 *
 * Staff type what they actually counted, not the difference — counting is what they just
 * did, subtraction is a chance to get it wrong. The dialog shows the difference it is
 * about to record so there is no doubt about what will happen.
 *
 * A reason is required. An unexplained correction is how stock quietly goes missing, so
 * the ledger always records who said what, and why.
 */
export function StockAdjustDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Pick<Product, "id" | "name" | "unit" | "onHand">
}) {
  const adjust = useAdjustStock()
  const [quantity, setQuantity] = useState<number | "">("")
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("adjustment")
  const [note, setNote] = useState("")

  const current = product.onHand
  const counted = quantity === "" ? current : quantity
  const change = counted - current

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Correct the stock of {product}", { product: product.name })}</DialogTitle>
          <DialogDescription>{t("Count the shelf and type what is actually there.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="s-quantity">
              Counted on the shelf — the system says {count(current)} {product.unit}
            </Label>
            <Input
              id="s-quantity"
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
              placeholder={String(current)}
              className="h-11 text-lg tabular-nums"
              autoFocus
            />
            {quantity !== "" && change !== 0 && (
              <p className={`text-sm ${change > 0 ? "text-success-soft-foreground dark:text-success" : "text-warning-soft-foreground dark:text-warning"}`}>
                This records {change > 0 ? "an increase" : "a decrease"} of{" "}
                <strong>
                  {change > 0 ? "+" : ""}
                  {count(change)}
                </strong>
                .
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("Why")}</Label>
            <div className="space-y-1">
              {REASONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReason(option.value)}
                  className={`w-full rounded-md border p-2.5 text-left text-sm transition ${
                    reason === option.value ? "border-primary bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <div className="font-medium">{t(option.label)}</div>
                  <div className="text-xs text-muted-foreground">{t(option.hint)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-note">{t("Note")}</Label>
            <Input
              id="s-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("Monthly stocktake, dropped in transit…")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={adjust.isPending || quantity === "" || change === 0}
            onClick={() =>
              adjust.mutate(
                { product: product.id, quantity: Number(quantity), reason, note },
                {
                  onSuccess: () => {
                    setQuantity("")
                    setNote("")
                    onOpenChange(false)
                  },
                },
              )
            }
          >
            {adjust.isPending && <Spinner />}
            {change === 0 ? t("No change") : t("Record it")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
