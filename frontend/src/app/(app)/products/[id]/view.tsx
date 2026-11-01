"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Archive, Pencil, Printer, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState, PageHeader, TableSkeleton } from "@/components/common"
import { DataView, Primary } from "@/components/data-view"
import { ProductDialog } from "@/components/product-form"
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useBranchScope, useCurrency, useSettings } from "@/components/session"
import { useProduct, useStockMovements } from "@/lib/data/queries"
import { count, friendlyDateTime, money } from "@/lib/format"

const REASON_LABEL: Record<string, string> = {
  purchase: "Bought in",
  rent_out: "Rented out",
  rent_return: "Back from rent",
  sale: "Sold",
  sale_return: "Sale returned",
  supplier_return: "Sent to supplier",
  adjustment: "Corrected",
  damage: "Damaged",
  lost: "Lost",
}

/** One product: its rates, where the stock sits, and every movement in and out of it. */
export function ProductDetailView({
  id,
  canEdit,
  canAdjust,
}: {
  id: string
  canEdit: boolean
  canAdjust: boolean
}) {
  const currency = useCurrency()
  const settings = useSettings()
  const { branches } = useBranchScope()
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const { data: product, isLoading, isError, error, refetch } = useProduct(id)
  const movements = useStockMovements({ page: 1, product: id }, { pageSize: 25 })

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !product) return <TableSkeleton rows={5} columns={4} />

  const threshold = product.lowStockThreshold || settings.lowStockAlert

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={product.description || undefined}
        back={{ href: "/products", label: "Products" }}
      >
        {canAdjust && (
          <Button variant="outline" onClick={() => setAdjusting(true)}>
            <SlidersHorizontal className="size-4" />
            Correct stock
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        )}
        {product.rentable && product.onHand > 0 && <ButtonLink href={`/rent-out?code=${encodeURIComponent(product.barcode || product.sku)}`}>Rent out</ButtonLink>}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where it is</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">On the shelf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((branch) => {
                    const quantity = product.stock[branch.id] ?? 0
                    return (
                      <TableRow key={branch.id}>
                        <TableCell>{branch.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={quantity <= threshold ? "text-warning-soft-foreground dark:text-warning" : undefined}>
                            {count(quantity)}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  <TableRow>
                    <TableCell className="font-medium">Out on rent</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{count(product.outOnRent)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {movements.isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={4} columns={4} />
                </div>
              ) : (
                <div className="px-3 pb-3 md:px-0 md:pb-0">
                  <DataView
                    label="Stock history"
                    className="md:rounded-none md:border-0"
                    rows={movements.data?.results ?? []}
                    getKey={(move) => move.id}
                    columns={[
                      {
                        id: "what",
                        header: "What happened",
                        role: "title",
                        cell: (move) => (
                          <Primary sub={move.note || friendlyDateTime(move.at)}>
                            {REASON_LABEL[move.reason] ?? move.reason}
                          </Primary>
                        ),
                      },
                      {
                        id: "change",
                        header: "Change",
                        align: "end",
                        cell: (move) => (
                          <span
                            className={
                              move.change > 0 ? "text-success-soft-foreground dark:text-success" : "text-destructive"
                            }
                          >
                            {move.change > 0 ? "+" : ""}
                            {count(move.change)}
                          </span>
                        ),
                      },
                      {
                        id: "left",
                        header: "Left",
                        align: "end",
                        cell: (move) => <span className="text-muted-foreground">{count(move.balance)}</span>,
                      },
                      {
                        id: "when",
                        header: "When",
                        role: "hidden",
                        cell: (move) => <span className="whitespace-nowrap">{friendlyDateTime(move.at)}</span>,
                      },
                      {
                        id: "who",
                        header: "Who",
                        cell: (move) => <span className="text-muted-foreground">{move.byName || "—"}</span>,
                      },
                    ]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {product.rentable ? (
                <>
                  {product.rentDaily != null && <Row label="Per day" value={money(product.rentDaily, currency)} />}
                  {product.rentWeekly != null && <Row label="Per week" value={money(product.rentWeekly, currency)} />}
                  {product.rentMonthly != null && <Row label="Per month" value={money(product.rentMonthly, currency)} />}
                  {product.deposit > 0 && <Row label="Deposit each" value={money(product.deposit, currency)} />}
                  {product.replacementCost > 0 && (
                    <Row label="Replacement" value={money(product.replacementCost, currency)} />
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Not set up for renting.</p>
              )}
              {product.sellable && <Row label="Sale price" value={money(product.price, currency)} />}
              <Row label="Cost each" value={money(product.cost, currency)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Label</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* The printable shelf label. Scanning this QR on the rent-out or take-back
                  screen finds the product, so items with no manufacturer barcode can still
                  be scanned rather than typed. */}
              <div className="receipt flex flex-col items-center gap-2 rounded-md bg-white p-4 text-black">
                <QRCodeSVG value={`sku:${product.sku}`} size={120} level="M" />
                <div className="text-center">
                  <div className="text-sm font-semibold">{product.name}</div>
                  <div className="font-mono text-xs">{product.sku}</div>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => window.print()}>
                <Printer className="size-4" />
                Print label
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="SKU" value={product.sku} mono />
              {product.barcode && <Row label="Barcode" value={product.barcode} mono />}
              <Row label="Unit" value={product.unit} />
              {product.category && <Row label="Category" value={product.category} />}
              <Row label="Low stock at" value={count(threshold)} />
              {product.archivedAt && (
                <Badge variant="secondary" className="gap-1">
                  <Archive className="size-3" />
                  Archived
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ProductDialog open={editing} onOpenChange={setEditing} product={product} onSaved={() => setEditing(false)} />
      <StockAdjustDialog open={adjusting} onOpenChange={setAdjusting} product={product} />
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`shrink-0 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}
