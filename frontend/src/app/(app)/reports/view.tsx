"use client"

import { useState } from "react"
import { AlertTriangle, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState, PageHeader, StatGrid, StatTile } from "@/components/common"
import { DataView, Code, Primary, type Column } from "@/components/data-view"
import { useCurrency } from "@/components/session"
import {
  exportUrl,
  useCustomerReport,
  useProductReport,
  useReportSummary,
  useRevenueReport,
} from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import { DEFAULT_PRESET, PRESETS, periodLabel, presetFor, rangeLabel } from "@/lib/reports"
import type { CustomerReportRow, ProductReportRow, ReportExport, ReportRange, RevenueRow } from "@/lib/types"

/**
 * The owner's end-of-month screen.
 *
 * It answers four questions in the order they get asked: what did we earn, when did we
 * earn it, which machines earned it, and who still owes us. Everything below the figures
 * is downloadable, because the real end of this job is sending a file to an accountant.
 *
 * The one thing worth knowing about the numbers: rent is earned when items come *back*,
 * since that is when the length of the hire — and so the price — is finally known. So
 * "Earned" totals the returns taken in the range, while "Rentals started" counts the
 * rentals that went out in it. They are deliberately different figures.
 */
export function ReportsView({ canSeeSpend }: { canSeeSpend: boolean }) {
  const currency = useCurrency()
  const [range, setRange] = useState<ReportRange>(DEFAULT_PRESET.range)

  const summary = useReportSummary(range)
  const revenue = useRevenueReport(range)
  const products = useProductReport(range)
  const customers = useCustomerReport(range)

  const s = summary.data
  const busy = summary.isFetching || revenue.isFetching

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PageHeader title="Reports" description={rangeLabel(range) + (busy ? " · updating…" : "")} />
        <RangePicker range={range} onChange={setRange} />
      </div>

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          {/* Earned in the range. Four figures, because a fifth would make all five
              forgettable — the rest are in the strip underneath. */}
          <StatGrid>
            <StatTile label="Earned" value={money(s?.revenue ?? 0, currency)} loading={!s} />
            <StatTile label="Rent" value={money(s?.rent ?? 0, currency)} loading={!s} />
            <StatTile
              label="Late fees"
              value={money(s?.lateFees ?? 0, currency)}
              loading={!s}
              tone={s?.lateFees ? "warning" : "default"}
            />
            <StatTile
              label="Owed by customers"
              value={money(s?.outstanding ?? 0, currency)}
              loading={!s}
              tone={s?.outstanding ? "danger" : "default"}
              hint="All time"
            />
          </StatGrid>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 text-sm sm:flex sm:flex-wrap sm:gap-x-10">
            <Quiet label="Rentals started" value={count(s?.rentals ?? 0)} />
            <Quiet label="Units sent out" value={count(s?.unitsRented ?? 0)} />
            <Quiet label="Units returned" value={count(s?.unitsReturned ?? 0)} />
            <Quiet label="Returns taken" value={count(s?.returns ?? 0)} />
            <Quiet label="Cash collected" value={money(s?.collected ?? 0, currency)} />
            <Quiet label="Deposits held" value={money(s?.depositsHeld ?? 0, currency)} />
            <Quiet label="New customers" value={count(s?.newCustomers ?? 0)} />
            {canSeeSpend && <Quiet label="Spent on stock" value={money(s?.purchaseSpend ?? 0, currency)} />}
          </dl>

          {(s?.unitsLost || s?.unitsDamaged) ? (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-soft-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {count(s.unitsLost)} {s.unitsLost === 1 ? "unit never came" : "units never came"} back and{" "}
                {count(s.unitsDamaged)} came back damaged, charged at{" "}
                {money(s.damageFees, currency)} in replacement costs.
              </span>
            </p>
          ) : null}

          <RevenueChart
            rows={revenue.data?.results ?? []}
            group={revenue.data?.group ?? "day"}
            currency={currency}
            loading={revenue.isLoading}
            href={exportUrl("revenue", range)}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <ProductTable
              rows={products.data?.results ?? []}
              currency={currency}
              loading={products.isLoading}
              href={exportUrl("products", range)}
            />
            <CustomerTable
              rows={customers.data?.results ?? []}
              currency={currency}
              loading={customers.isLoading}
              href={exportUrl("customers", range)}
            />
          </div>

          <Ledgers range={range} />
        </>
      )}
    </div>
  )
}

/** The presets people actually ask for, with typed dates for everything else. */
function RangePicker({ range, onChange }: { range: ReportRange; onChange: (r: ReportRange) => void }) {
  const active = presetFor(range)
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            size="sm"
            className="shrink-0"
            variant={active === preset.id ? "default" : "outline"}
            onClick={() => onChange(preset.range())}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
          className="h-9 w-auto flex-1 sm:flex-none"
          aria-label="From"
        />
        <span className="text-muted-foreground">to</span>
        <Input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
          className="h-9 w-auto flex-1 sm:flex-none"
          aria-label="To"
        />
      </div>
    </div>
  )
}

/**
 * Revenue over the range, drawn as bars.
 *
 * Deliberately CSS and not a charting library: it is one series of a few dozen values, and
 * a div per bar renders identically on the server and the client, costs nothing, and keeps
 * the tabular figures of the rest of the page. The table underneath is the real data —
 * screen readers and anyone wanting exact numbers get it rather than a picture.
 */
function RevenueChart({
  rows,
  group,
  currency,
  loading,
  href,
}: {
  rows: RevenueRow[]
  group: "day" | "week" | "month"
  currency: string
  loading: boolean
  href: string
}) {
  const peak = Math.max(...rows.map((r) => r.revenue), 1)
  const label = { day: "day", week: "week", month: "month" }[group]

  return (
    <section className="space-y-3">
      <SectionHead
        title={`Earned per ${label}`}
        hint={rows.length ? `Peak ${money(peak, currency)}` : undefined}
        href={href}
        download="revenue"
      />
      {loading ? (
        <Skeleton className="h-44 w-full" />
      ) : rows.length === 0 ? (
        <Empty>Nothing came back in this period, so nothing was charged.</Empty>
      ) : (
        <div className="rounded-lg border p-4">
          {/* Bars are capped in width so a single day doesn't become a billboard, and the
              baseline is a real rule so a day that earned nothing still reads as a day. */}
          <div className="flex h-40 items-end gap-1 border-b" role="presentation">
            {rows.map((row) => (
              <div
                key={row.period}
                className="group relative w-full max-w-10 rounded-t-sm bg-primary/70 transition-colors hover:bg-primary"
                style={{ height: `${Math.max((row.revenue / peak) * 100, 1.5)}%` }}
              >
                {/* Plain markup, so the figure is there for a long press on a phone too. */}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover:block">
                  {periodLabel(row.period, group)} · {money(row.revenue, currency)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{periodLabel(rows[0].period, group)}</span>
            {rows.length > 1 && <span>{periodLabel(rows[rows.length - 1].period, group)}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function ProductTable({
  rows,
  currency,
  loading,
  href,
}: {
  rows: ProductReportRow[]
  currency: string
  loading: boolean
  href: string
}) {
  return (
    <section className="space-y-3">
      <SectionHead title="What earned the most" href={href} download="products" />
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <Empty>No items came back in this period.</Empty>
      ) : (
        <DataView
          label="What earned the most"
          rows={rows.slice(0, 8)}
          getKey={(row) => row.id ?? row.name}
          href={(row) => (row.id ? `/products/${row.id}` : "")}
          columns={[
            {
              id: "product",
              header: "Product",
              role: "title",
              cell: (row) => (
                <Primary
                  sub={
                    <>
                      <Code>{row.sku}</Code>
                      {row.lost > 0 && <span className="ml-2 text-destructive">{row.lost} lost</span>}
                    </>
                  }
                >
                  {row.name}
                </Primary>
              ),
            },
            { id: "units", header: "Units", align: "end", cell: (row) => count(row.units) },
            {
              id: "earned",
              header: "Earned",
              align: "end",
              cell: (row) => <span className="font-medium">{money(row.revenue, currency)}</span>,
            },
          ] satisfies Column<ProductReportRow>[]}
        />
      )}
    </section>
  )
}

function CustomerTable({
  rows,
  currency,
  loading,
  href,
}: {
  rows: CustomerReportRow[]
  currency: string
  loading: boolean
  href: string
}) {
  return (
    <section className="space-y-3">
      <SectionHead title="Best customers" href={href} download="customers" />
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <Empty>Nobody returned anything in this period.</Empty>
      ) : (
        <DataView
          label="Best customers"
          rows={rows.slice(0, 8)}
          getKey={(row) => row.id ?? row.name}
          href={(row) => (row.id ? `/customers/${row.id}` : "")}
          columns={[
            {
              id: "customer",
              header: "Customer",
              role: "title",
              cell: (row) => <Primary sub={row.phone || `${count(row.rentals)} rentals`}>{row.name}</Primary>,
            },
            {
              id: "spent",
              header: "Spent",
              align: "end",
              cell: (row) => <span className="font-medium">{money(row.revenue, currency)}</span>,
            },
            {
              id: "owes",
              header: "Owes",
              align: "end",
              cell: (row) =>
                row.outstanding > 0 ? (
                  <span className="text-destructive">{money(row.outstanding, currency)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
          ] satisfies Column<CustomerReportRow>[]}
        />
      )}
    </section>
  )
}

/** The full records, for the accountant. Not shown on screen — there is nothing to read in
 *  40,000 rows — so this is a list of files and what each one contains. */
function Ledgers({ range }: { range: ReportRange }) {
  const files: { report: ReportExport; title: string; description: string }[] = [
    { report: "rentals", title: "Rentals", description: "Every rental started in this period, with its charges and balance." },
    { report: "returns", title: "Returns", description: "Every item taken back, with the days billed and what it cost." },
    { report: "payments", title: "Payments", description: "Money in and out against rentals, to reconcile the till." },
  ]
  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-sm font-medium">Download the full records</h2>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {files.map((file) => (
          <li key={file.report} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">{file.title}</div>
              <p className="text-sm text-muted-foreground">{file.description}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 max-sm:w-full"
              render={<a href={exportUrl(file.report, range)} download />}
            >
              <Download className="size-4" />
              CSV
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SectionHead({
  title,
  hint,
  href,
  download,
}: {
  title: string
  hint?: string
  href: string
  download: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-medium">
        {title}
        {hint && <span className="ml-2 text-sm font-normal text-muted-foreground">{hint}</span>}
      </h2>
      <a
        href={href}
        download
        className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <Download className="size-3.5" />
        <span className="sr-only">Download {download} as </span>CSV
      </a>
    </div>
  )
}

function Quiet({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{children}</p>
}
