"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { AlertTriangle, Archive, Boxes, Package, Pencil, Printer, ShieldAlert, SlidersHorizontal, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CopyValue, ErrorState, PageHeader, Pill, StatCard, StatGrid, TableSkeleton } from "@/components/common"
import { DataView, Primary } from "@/components/data-view"
import { ProductDialog } from "@/components/product-form"
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useBranchScope, useCurrency, useSettings } from "@/components/session"
import { useProduct, useStockMovements } from "@/lib/data/queries"
import { count, friendlyDateTime, money } from "@/lib/format"

const REASON_LABEL: Record<string, string> = {
  // Old entries only: nothing is bought in or sent back through the app any more.
  purchase: "Bought in",
  rent_out: "Rented out",
  rent_return: "Back from rent",
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
  const low = !product.archivedAt && product.onHand <= threshold
  const rates = [
    { label: "Per day", value: product.rentDaily },
    { label: "Per week", value: product.rentWeekly },
    { label: "Per month", value: product.rentMonthly },
  ].filter((rate) => rate.value != null)

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        badge={
          product.archivedAt ? (
            <Pill>
              <Archive className="size-3" />
              Archived
            </Pill>
          ) : low ? (
            // Red, and beside the name: the first thing to know about this product today.
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white">
              <AlertTriangle className="size-3.5" />
              {product.onHand > 0 ? `Low stock · ${count(product.onHand)} available` : "Out of stock · 0 available"}
            </span>
          ) : undefined
        }
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

      {/* How many there are, at a glance. Only "Available" ever takes a colour, and only
          when it is low, so red on this row always means the same thing. */}
      <StatGrid>
        <StatCard
          label="Available"
          value={count(product.onHand)}
          hint={low ? `Low: warns at ${count(threshold)}` : `Warns at ${count(threshold)}`}
          icon={Package}
          tone={low ? "danger" : "good"}
        />
        <StatCard label="Out on rent" value={count(product.outOnRent)} icon={Truck} />
        <StatCard label="Total owned" value={count(product.onHand + product.outOnRent)} icon={Boxes} />
        <StatCard
          label="Replacement cost"
          value={product.replacementCost > 0 ? money(product.replacementCost, currency) : "—"}
          hint="Each, if damaged or lost"
          icon={ShieldAlert}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rent prices</CardTitle>
            </CardHeader>
            <CardContent>
              {product.rentable && rates.length > 0 ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  {rates.map((rate) => (
                    <div key={rate.label} className="rounded-lg border bg-muted/40 px-4 py-3">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{rate.label}</dt>
                      <dd className="mt-1 font-heading text-2xl font-semibold tracking-tight tabular-nums">
                        {money(rate.value, currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">No rent price set.</p>
              )}
            </CardContent>
          </Card>

          {branches.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where it is</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branches.map((branch) => {
                      const quantity = product.stock[branch.id] ?? 0
                      return (
                        <TableRow key={branch.id}>
                          <TableCell>{branch.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={quantity <= threshold ? "font-semibold text-destructive" : undefined}>
                              {count(quantity)}
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

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
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm [&>div]:flex [&>div]:min-h-10 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-1.5">
                <div>
                  <dt className="shrink-0 text-muted-foreground">SKU</dt>
                  <dd className="flex min-w-0 justify-end">
                    <CopyValue value={product.sku} label="SKU" />
                  </dd>
                </div>
                <div>
                  <dt className="shrink-0 text-muted-foreground">Barcode</dt>
                  <dd className="flex min-w-0 justify-end">
                    {product.barcode ? <CopyValue value={product.barcode} label="Barcode" /> : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="shrink-0 text-muted-foreground">Category</dt>
                  <dd className="truncate">{product.category || "—"}</dd>
                </div>
              </dl>
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
              <div className="receipt-paper flex flex-col items-center gap-2 rounded-md bg-white p-4 text-black">
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
        </div>
      </div>

      <ProductDialog open={editing} onOpenChange={setEditing} product={product} onSaved={() => setEditing(false)} />
      <StockAdjustDialog open={adjusting} onOpenChange={setAdjusting} product={product} />
    </div>
  )
}
