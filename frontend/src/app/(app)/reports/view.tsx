"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState, PageHeader, TableSkeleton } from "@/components/common"
import { PrintButton } from "@/components/paper"
import { ReportDocument } from "@/components/report"
import { useCurrency, useSession } from "@/components/session"
import {
  exportUrl,
  reportPdfUrl,
  useCustomerReport,
  useDebtorReport,
  useProductReport,
  useReportSummary,
  useRevenueReport,
} from "@/lib/data/queries"
import { logoUrl } from "@/lib/logo"
import { DEFAULT_PRESET, PRESETS, presetFor, rangeLabel } from "@/lib/reports"
import type { ReportExport, ReportRange } from "@/lib/types"

/**
 * The owner's end-of-month screen.
 *
 * Three parts, top to bottom: pick the dates, read the report, take it away. The report is
 * a sheet (see `ReportDocument`) rather than a dashboard, because the end of this job is a
 * piece of paper on the owner's desk or a file sent to an accountant — so Print and
 * Download PDF sit at the top, and what is on screen is exactly what they produce. The
 * raw records behind it are the CSV files at the bottom.
 */
export function ReportsView() {
  const currency = useCurrency()
  const { business } = useSession()
  const [range, setRange] = useState<ReportRange>(DEFAULT_PRESET.range)

  const summary = useReportSummary(range)
  const revenue = useRevenueReport(range)
  const products = useProductReport(range)
  const customers = useCustomerReport(range)
  const debtors = useDebtorReport()

  const parts = [summary, revenue, products, customers, debtors]
  const failed = parts.find((part) => part.isError)
  const busy = parts.some((part) => part.isFetching)
  const ready = summary.data && revenue.data && products.data && customers.data && debtors.data

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="space-y-4 print:hidden">
        <PageHeader
          title="Reports"
          description={rangeLabel(range) + (busy ? " · updating…" : "")}
        >
          <PrintButton />
          <Button render={<a href={reportPdfUrl(range)} download />}>
            <Download className="size-4" />
            Download PDF
          </Button>
        </PageHeader>
        <RangePicker range={range} onChange={setRange} />
      </div>

      {failed ? (
        <ErrorState error={failed.error} onRetry={() => parts.forEach((part) => part.refetch())} />
      ) : !ready ? (
        <TableSkeleton rows={10} columns={4} />
      ) : (
        <ReportDocument
          report={{
            range,
            summary: summary.data,
            group: revenue.data.group,
            revenue: revenue.data.results,
            products: products.data.results,
            customers: customers.data.results,
            debtors: debtors.data.results,
          }}
          business={{ name: business?.name ?? "Report", address: business?.address, phone: business?.phone }}
          logo={logoUrl(business?.logoVersion)}
          currency={currency}
        />
      )}

      <Records range={range} />
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

const FILES: { report: ReportExport; title: string; description: string }[] = [
  { report: "rentals", title: "Rentals", description: "Every rental started in this period, with its charges and balance." },
  { report: "returns", title: "Returns", description: "Every item taken back, with the days billed and what it cost." },
  { report: "payments", title: "Payments", description: "Money in and out against rentals, to reconcile the till." },
  { report: "revenue", title: "Earnings by date", description: "The earned-per-day table above, in full." },
  { report: "products", title: "Products", description: "Every product that earned something, not just the top ten." },
  { report: "customers", title: "Customers", description: "Every customer who returned something, with what they owe." },
  { report: "debtors", title: "Who owes", description: "Everyone with an unpaid balance today." },
]

/**
 * The full records, for the accountant. Not shown on screen — there is nothing to read in
 * 40,000 rows — so this is a list of spreadsheet files and what each one contains.
 */
function Records({ range }: { range: ReportRange }) {
  return (
    <section className="space-y-3 border-t pt-6 print:hidden">
      <div>
        <h2 className="text-sm font-medium">Spreadsheet files</h2>
        <p className="text-sm text-muted-foreground">The records behind the report, for the same dates. They open in Excel.</p>
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {FILES.map((file) => (
          <li key={file.report} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{file.title}</div>
              <p className="text-sm text-muted-foreground">{file.description}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              render={<a href={exportUrl(file.report, range)} download aria-label={`Download ${file.title} as a spreadsheet`} />}
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
