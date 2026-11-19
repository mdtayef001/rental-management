"use client"

import { useState } from "react"
import { AlertTriangle, Archive, Boxes, Package, Pencil, ShieldAlert, SlidersHorizontal, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CopyValue, ErrorState, PageHeader, Pill, StatCard, StatGrid, TableSkeleton } from "@/components/common"
import { DataView, Primary } from "@/components/data-view"
import { LabelPrinter } from "@/components/product-label"
import { ProductDialog } from "@/components/product-form"
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useCurrency, useSettings } from "@/components/session"
import { useProduct, useStockMovements } from "@/lib/data/queries"
import { count, friendlyDateTime, money } from "@/lib/format"
import { msg, t } from "@/lib/i18n"

const REASON_LABEL: Record<string, string> = {
  // Old entries only: nothing is bought in or sent back through the app any more.
  purchase: msg("Bought in"),
  rent_out: msg("Rented out"),
  rent_return: msg("Back from rent"),
  supplier_return: msg("Sent to supplier"),
  adjustment: msg("Corrected"),
  damage: msg("Damaged"),
  lost: msg("Lost"),
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
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const { data: product, isLoading, isError, error, refetch } = useProduct(id)
  const movements = useStockMovements({ page: 1, product: id }, { pageSize: 25 })

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !product) return <TableSkeleton rows={5} columns={4} />

  const threshold = product.lowStockThreshold || settings.lowStockAlert
  const low = !product.archivedAt && product.isLow
  const rates = [
    { label: t("Per day"), value: product.rentDaily },
    { label: t("Per week"), value: product.rentWeekly },
    { label: t("Per month"), value: product.rentMonthly },
  ].filter((rate) => rate.value != null)

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        badge={
          product.archivedAt ? (
            <Pill>
              <Archive className="size-3" />
              {t("Archived")}
            </Pill>
          ) : low ? (
            // Red, and beside the name: the first thing to know about this product today.
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white">
              <AlertTriangle className="size-3.5" />
              {product.onHand > 0 ? t("Low stock · {count} available", { count: count(product.onHand) }) : t("Out of stock · 0 available")}
            </span>
          ) : undefined
        }
        description={product.description || undefined}
        back={{ href: "/products", label: t("Products") }}
      >
        {canAdjust && (
          <Button variant="outline" onClick={() => setAdjusting(true)}>
            <SlidersHorizontal className="size-4" />
            {t("Correct stock")}
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            {t("Edit")}
          </Button>
        )}
        {product.rentable && product.onHand > 0 && <ButtonLink href={`/rent-out?code=${encodeURIComponent(product.barcode || product.sku)}`}>{t("Rent out")}</ButtonLink>}
      </PageHeader>

      {/* How many there are, at a glance. Only "Available" ever takes a colour, and only
          when it is low, so red on this row always means the same thing. */}
      <StatGrid>
        <StatCard
          label={t("Available")}
          value={count(product.onHand)}
          hint={low ? t("Low: warns at {count}", { count: count(threshold) }) : t("Warns at {count}", { count: count(threshold) })}
          icon={Package}
          tone={low ? "danger" : "good"}
        />
        <StatCard label={t("Out on rent")} value={count(product.outOnRent)} icon={Truck} />
        <StatCard label={t("Total owned")} value={count(product.onHand + product.outOnRent)} icon={Boxes} />
        <StatCard
          label={t("Replacement cost")}
          value={product.replacementCost > 0 ? money(product.replacementCost, currency) : "—"}
          hint={t("Each, if damaged or lost")}
          icon={ShieldAlert}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Rent prices")}</CardTitle>
            </CardHeader>
            <CardContent>
              {product.rentable && rates.length > 0 ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  {rates.map((rate) => (
                    <div key={rate.label} className="rounded-lg border bg-muted/40 px-4 py-3">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(rate.label)}</dt>
                      <dd className="mt-1 font-heading text-2xl font-semibold tracking-tight tabular-nums">
                        {money(rate.value, currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{t("No rent price set.")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Stock history")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {movements.isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={4} columns={4} />
                </div>
              ) : (
                <div className="px-3 pb-3 md:px-0 md:pb-0">
                  <DataView
                    label={t("Stock history")}
                    className="md:rounded-none md:border-0"
                    rows={movements.data?.results ?? []}
                    getKey={(move) => move.id}
                    columns={[
                      {
                        id: "what",
                        header: t("What happened"),
                        role: "title",
                        cell: (move) => (
                          <Primary sub={(move.note && t(move.note)) || friendlyDateTime(move.at)}>
                            {t(REASON_LABEL[move.reason] ?? move.reason)}
                          </Primary>
                        ),
                      },
                      {
                        id: "change",
                        header: t("Change"),
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
                        header: t("Left"),
                        align: "end",
                        cell: (move) => <span className="text-muted-foreground">{count(move.balance)}</span>,
                      },
                      {
                        id: "when",
                        header: t("When"),
                        role: "hidden",
                        cell: (move) => <span className="whitespace-nowrap">{friendlyDateTime(move.at)}</span>,
                      },
                      {
                        id: "who",
                        header: t("Who"),
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
              <CardTitle className="text-base">{t("Details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm [&>div]:flex [&>div]:min-h-10 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-1.5">
                <div>
                  <dt className="shrink-0 text-muted-foreground">{t("SKU")}</dt>
                  <dd className="flex min-w-0 justify-end">
                    <CopyValue value={product.sku} label={t("SKU")} />
                  </dd>
                </div>
                <div>
                  <dt className="shrink-0 text-muted-foreground">{t("Barcode")}</dt>
                  <dd className="flex min-w-0 justify-end">
                    {product.barcode ? <CopyValue value={product.barcode} label={t("Barcode")} /> : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="shrink-0 text-muted-foreground">{t("Category")}</dt>
                  <dd className="truncate">{product.category || "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Label")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* The sticker for the machine itself. Scanning its QR or its barcode on
                  Rent out, Take back or Scan finds this product, so items with no maker's
                  barcode can still be scanned rather than typed. */}
              <LabelPrinter product={product} />
            </CardContent>
          </Card>
        </div>
      </div>

      <ProductDialog open={editing} onOpenChange={setEditing} product={product} onSaved={() => setEditing(false)} />
      <StockAdjustDialog open={adjusting} onOpenChange={setAdjusting} product={product} />
    </div>
  )
}
