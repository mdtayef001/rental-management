"use client"

import { useState } from "react"
import { PackageX, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatTile, TableSkeleton } from "@/components/common"
import { CodeInput } from "@/components/scanner"
import { useBranchScope, useCurrency } from "@/components/session"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { useCreatePurchase } from "@/lib/data/mutations"
import { useDebounced, usePaging, usePurchases, usePurchaseSummary, useSuppliers } from "@/lib/data/queries"
import { count, date, money, plural } from "@/lib/format"
import type { ProductLookup } from "@/lib/types"

/** Stock bought in: the bills, what was paid, and what is still owed. */
export function PurchasesView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, status)
  const [recording, setRecording] = useState(false)

  const filters = { search, paymentStatus: status }
  const { data, isLoading, isFetching, isError, error, refetch } = usePurchases({ page, ...filters }, { pageSize })
  const { data: summary } = usePurchaseSummary(filters)

  return (
    <div className="space-y-6">
      <PageHeader title="Purchases" description="Stock bought in, and what you still owe for it.">
        <ButtonLink href="/supplier-returns" variant="outline">
          <PackageX className="size-4" />
          Sent back
        </ButtonLink>
        <Button onClick={() => setRecording(true)}>
          <Plus className="size-4" />
          Record a purchase
        </Button>
      </PageHeader>

      {summary && summary.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Bills" value={count(summary.count)} />
          <StatTile label="Bought in total" value={money(summary.total, currency)} />
          <StatTile label="Still owed" value={money(summary.due, currency)} tone={summary.due ? "warning" : "default"} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Supplier, invoice number or product"
            className="pl-9"
            aria-label="Search purchases"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              { value: "", label: "All" },
              { value: "owing", label: "Unpaid" },
              { value: "paid", label: "Paid" },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={status === option.value ? "default" : "outline"}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "No purchases recorded"}
          description="Record what you buy in to keep stock levels and item costs accurate."
          action={<Button onClick={() => setRecording(true)}>Record a purchase</Button>}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{purchase.code}</span>
                      <div className="text-xs text-muted-foreground">{date(purchase.purchasedAt)}</div>
                      {purchase.reference && (
                        <div className="text-xs text-muted-foreground">Their ref: {purchase.reference}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{purchase.supplierName || "No supplier"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {plural(purchase.items.length, "product")}
                      <div className="text-xs">
                        {count(purchase.items.reduce((n, i) => n + i.quantity, 0))} units
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(purchase.total, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {purchase.due > 0 ? (
                        <span className="text-amber-600 dark:text-amber-500">{money(purchase.due, currency)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {purchase.paymentStatus === "paid" ? (
                        <Badge variant="outline">Paid</Badge>
                      ) : purchase.isOverdue ? (
                        <Badge variant="destructive">Past due</Badge>
                      ) : (
                        <Badge variant="secondary">
                          {purchase.paymentStatus === "partly_paid" ? "Part paid" : "Unpaid"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.count ?? 0}
            onPage={setPage}
            onPageSize={setPageSize}
            busy={isFetching}
          />
        </>
      )}

      {recording && <PurchaseDialog onClose={() => setRecording(false)} />}
    </div>
  )
}

interface PurchaseLine {
  product: ProductLookup
  quantity: number
  unitCost: number
}

/**
 * Recording a bill.
 *
 * Scanning in is the same gesture as renting out, so the two screens behave alike. Saving
 * raises the stock and moves each product's cost to the weighted average of what was
 * already on hand and what was just paid — which is what keeps profit honest later.
 */
function PurchaseDialog({ onClose }: { onClose: () => void }) {
  const currency = useCurrency()
  const { branches, defaultBranchId, showPicker } = useBranchScope()
  const create = useCreatePurchase()
  const suppliers = useSuppliers({ page: 1 }, { pageSize: 100 })

  const [branchId, setBranchId] = useState(defaultBranchId)
  const [supplierId, setSupplierId] = useState("")
  const [reference, setReference] = useState("")
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paid, setPaid] = useState<number | "">("")
  const [method, setMethod] = useState("cash")
  const [dueDate, setDueDate] = useState("")
  const [adding, setAdding] = useState(false)

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)
  const paidValue = paid === "" ? 0 : paid
  // A bill with nobody to owe has to be settled now, which is what Django enforces too.
  const noSupplierUnpaid = !supplierId && paidValue < total

  async function addCode(code: string) {
    setAdding(true)
    try {
      const product = await request<ProductLookup>(`products/lookup/?code=${encodeURIComponent(code)}`)
      setLines((current) => {
        const index = current.findIndex((l) => l.product.id === product.id)
        if (index >= 0) {
          const next = [...current]
          next[index] = { ...next[index], quantity: next[index].quantity + 1 }
          return next
        }
        return [...current, { product, quantity: 1, unitCost: 0 }]
      })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't find that code.")
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record a purchase</DialogTitle>
          <DialogDescription>
            This raises the stock and updates what each item costs you on average.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pu-supplier">Supplier</Label>
              <select
                id="pu-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">No supplier (paid in full)</option>
                {suppliers.data?.results.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pu-ref">Their invoice number</Label>
              <Input id="pu-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            {showPicker && (
              <div className="space-y-2">
                <Label htmlFor="pu-branch">Received at</Label>
                <select
                  id="pu-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label>Items</Label>
            <CodeInput onSubmit={addCode} busy={adding} placeholder="Scan or type a barcode / SKU" />
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Scan what arrived, or type its SKU.
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((line, index) => (
                  <div key={line.product.id} className="flex flex-wrap items-end gap-2 rounded-md border p-2.5">
                    <div className="min-w-32 flex-1">
                      <div className="truncate text-sm font-medium">{line.product.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{line.product.sku}</div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((c) =>
                            c.map((l, i) => (i === index ? { ...l, quantity: Math.max(1, Number(e.target.value)) } : l)),
                          )
                        }
                        className="h-9 w-24 tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cost each</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitCost || ""}
                        onChange={(e) =>
                          setLines((c) =>
                            c.map((l, i) => (i === index ? { ...l, unitCost: Math.max(0, Number(e.target.value)) } : l)),
                          )
                        }
                        className="h-9 w-28 tabular-nums"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="w-24 text-right text-sm tabular-nums">
                      {money(line.quantity * line.unitCost, currency)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                      aria-label={`Remove ${line.product.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pu-paid">Paid now</Label>
              <div className="flex gap-2">
                <Input
                  id="pu-paid"
                  type="number"
                  min={0}
                  value={paid}
                  onChange={(e) => setPaid(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  className="h-9 tabular-nums"
                  placeholder="0.00"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setPaid(total)}>
                  All
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pu-method">How</Label>
              <select
                id="pu-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="mobile">Mobile banking</option>
                <option value="bank">Bank</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pu-due">Rest due by</Label>
              <Input id="pu-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Bill total</span>
            <span className="text-lg font-semibold tabular-nums">{money(total, currency)}</span>
          </div>

          {noSupplierUnpaid && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              With no supplier there is nobody to owe, so this has to be paid in full.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || lines.length === 0 || noSupplierUnpaid}
            onClick={() =>
              create.mutate(
                {
                  supplier: supplierId || null,
                  branch: branchId,
                  lines: lines.map((l) => ({ product: l.product.id, quantity: l.quantity, unitCost: l.unitCost })),
                  reference,
                  paidAmount: paidValue,
                  method,
                  dueDate: dueDate || null,
                },
                { onSuccess: onClose },
              )
            }
          >
            {create.isPending && <Spinner />}
            Record {money(total, currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
