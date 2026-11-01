"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/common"
import { useBranchScope } from "@/components/session"
import { useAdjustStock } from "@/lib/data/mutations"
import { count } from "@/lib/format"
import type { Product } from "@/lib/types"

const REASONS = [
  { value: "adjustment", label: "Correcting a miscount", hint: "The shelf never matched the system." },
  { value: "damage", label: "Damaged or written off", hint: "Broken beyond use." },
  { value: "lost", label: "Lost or stolen", hint: "Gone, and not coming back." },
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
  product: Pick<Product, "id" | "name" | "unit" | "stock">
}) {
  const { branches, defaultBranchId, showPicker } = useBranchScope()
  const adjust = useAdjustStock()
  const [branchId, setBranchId] = useState(defaultBranchId)
  const [quantity, setQuantity] = useState<number | "">("")
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("adjustment")
  const [note, setNote] = useState("")

  const current = product.stock[branchId] ?? 0
  const counted = quantity === "" ? current : quantity
  const change = counted - current

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct the stock of {product.name}</DialogTitle>
          <DialogDescription>Count the shelf and type what is actually there.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="s-branch">Branch</Label>
              <select
                id="s-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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
            <Label>Why</Label>
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
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-note">Note</Label>
            <Input
              id="s-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Monthly stocktake, dropped in transit…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={adjust.isPending || quantity === "" || change === 0}
            onClick={() =>
              adjust.mutate(
                { product: product.id, branch: branchId, quantity: Number(quantity), reason, note },
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
            {change === 0 ? "No change" : "Record it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
