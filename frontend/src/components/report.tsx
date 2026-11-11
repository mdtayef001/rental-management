"use client"

import Link from "next/link"
import { Caption, Paper, PaperHeader, SheetPage, Sum, SumTotal, Sums } from "@/components/paper"
import { count, date, money } from "@/lib/format"
import { periodLabel, rangeLabel } from "@/lib/reports"
import type {
  CustomerReportRow,
  DebtorRow,
  ProductReportRow,
  ReportGroup,
  ReportRange,
  ReportSummary,
  RevenueRow,
} from "@/lib/types"

export interface ReportData {
  range: ReportRange
  summary: ReportSummary
  group: ReportGroup
  revenue: RevenueRow[]
  products: ProductReportRow[]
  customers: CustomerReportRow[]
  debtors: DebtorRow[]
}

/**
 * The owner's report, as one sheet.
 *
 * Drawn on the same paper as a bill, so the screen is the printout: what the owner reads
 * here is what comes out of the printer and what the PDF contains. It answers, in the
 * order they get asked: what did we earn, where did it come from, when, which products
 * earned it, who paid it, and who still owes us.
 *
 * The one thing worth knowing about the numbers: rent is earned when items come *back*,
 * since that is when the length of the hire — and so the price — is finally known. So
 * "Earned" totals the returns taken in the period, while "Rentals started" counts the
 * rentals that went out in it. They are deliberately different figures.
 */
export function ReportDocument({
  report,
  business,
  logo,
  currency,
}: {
  report: ReportData
  business: { name: string; address?: string; phone?: string }
  logo?: string | null
  currency: string
}) {
  const cash = (value: number) => money(value, currency)
  const s = report.summary
  const groupName = { day: "Day", week: "Week starting", month: "Month" }[report.group]

  return (
    <>
      <SheetPage />
      <Paper>
        <PaperHeader business={business} logo={logo} title="Business report">
          <p className="font-semibold">{rangeLabel(report.range)}</p>
          <p>Printed {date(new Date())}</p>
        </PaperHeader>

        {/* The four figures an owner asks for first, ruled as one table. */}
        <section className="mt-5 grid grid-cols-2 border-t border-l border-(--sheet-line) sm:grid-cols-4 print:grid-cols-4">
          <Figure label="Earned" value={cash(s.revenue)} />
          <Figure label="Money received" value={cash(s.collected - s.refunded)} />
          <Figure label="Owed by customers" value={cash(s.outstanding)} />
          <Figure
            label="Out on rent"
            value={`${count(s.unitsOut)} units`}
            note={`${count(s.openRentals)} rentals, ${count(s.overdue)} overdue`}
          />
        </section>

        <section className="bill-block mt-5 grid items-start gap-5 sm:grid-cols-2 print:grid-cols-2">
          <div>
            <Caption className="pb-1">Earned</Caption>
            <Sums>
              <Sum label="Rent" value={cash(s.rent)} />
              {s.lateFees > 0 && <Sum label="Late fees" value={cash(s.lateFees)} />}
              {s.damageFees > 0 && <Sum label="Damage and loss" value={cash(s.damageFees)} />}
              {s.discounts > 0 && <Sum label="Discounts given" value={cash(-s.discounts)} />}
              <SumTotal label="Total earned" value={cash(s.revenue)} />
            </Sums>
            {s.advancesHeld > 0 && (
              <Sums className="mt-2">
                <Sum label="Advances held, not yet earned" value={cash(s.advancesHeld)} />
              </Sums>
            )}
          </div>
          <div>
            <Caption className="pb-1">Activity</Caption>
            <Sums>
              <Sum label="Rentals started" value={count(s.rentals)} />
              <Sum label="Units sent out" value={count(s.unitsRented)} />
              <Sum label="Units returned" value={count(s.unitsReturned)} />
              <Sum label="Returns taken" value={count(s.returns)} />
              <Sum label="New customers" value={count(s.newCustomers)} />
              {s.unitsDamaged > 0 && <Sum label="Returned damaged" value={count(s.unitsDamaged)} />}
              {s.unitsLost > 0 && <Sum label="Never returned" value={count(s.unitsLost)} />}
            </Sums>
          </div>
        </section>

        {/* One row for each thing that came back: the day, who brought it, and which
            product, so any figure here can be traced to a rental. */}
        <Listing
          title={`Earned per ${report.group}`}
          empty="Nothing was earned in this period."
          head={[groupName, "Customer", "Product", "SKU / barcode", "Units", "Earned"]}
          widths={["w-[13%]", "w-[22%]", "", "w-[17%]", "w-[9%]", "w-[16%]"]}
          figuresFrom={4}
          rows={report.revenue.flatMap((row) => [
            ...row.details.map((line, index) => [
              // The date once per group, so the eye can find where a day starts.
              index === 0 ? <span className="font-semibold whitespace-nowrap">{periodLabel(row.period, report.group)}</span> : "",
              line.customer,
              line.product,
              <span key="c" className="font-mono text-[0.92em]">
                {line.sku || line.barcode || "—"}
              </span>,
              count(line.units),
              cash(line.amount),
            ]),
            ...(row.discounts > 0 ? [["", "Discount", "", "", "", cash(-row.discounts)]] : []),
          ])}
          total={[
            "Total",
            "",
            "",
            "",
            count(report.revenue.reduce((sum, row) => sum + row.details.reduce((n, line) => n + line.units, 0), 0)),
            cash(report.revenue.reduce((sum, row) => sum + row.revenue, 0)),
          ]}
        />

        <Listing
          title="Top products"
          empty="No items came back in this period."
          head={["Product", "Rentals", "Units", "Earned"]}
          widths={["", "w-[14%]", "w-[14%]", "w-[22%]"]}
          figuresFrom={1}
          rows={report.products.slice(0, 10).map((row) => [
            <Named key="n" href={row.id ? `/products/${row.id}` : null} name={row.name} />,
            count(row.rentals),
            count(row.units),
            cash(row.revenue),
          ])}
        />

        <Listing
          title="Top customers"
          empty="Nobody returned anything in this period."
          head={["Customer", "Rentals", "Spent", "Still owes"]}
          widths={["", "w-[14%]", "w-[22%]", "w-[22%]"]}
          figuresFrom={1}
          rows={report.customers.slice(0, 10).map((row) => [
            <Named key="n" href={row.id ? `/customers/${row.id}` : null} name={row.name} />,
            count(row.rentals),
            cash(row.revenue),
            row.outstanding > 0 ? cash(row.outstanding) : "—",
          ])}
        />

        <Listing
          title="Who owes you"
          empty="Nobody owes anything."
          head={["Customer", "Phone", "Still out", "Owes"]}
          widths={["", "w-[24%]", "w-[14%]", "w-[22%]"]}
          figuresFrom={2}
          rows={report.debtors.map((row) => [
            <Named key="n" href={row.id ? `/bills/${row.id}` : null} name={row.name} />,
            row.phone || "—",
            row.openRentals ? count(row.openRentals) : "—",
            cash(row.owed),
          ])}
        />
      </Paper>
    </>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-r border-b border-(--sheet-line) bg-white p-3">
      <Caption>{label}</Caption>
      <p className="mt-0.5 font-heading text-lg font-bold tabular-nums [overflow-wrap:anywhere]">{value}</p>
      {note && <p className="text-[0.9em]">{note}</p>}
    </div>
  )
}

/** A name that opens its record on screen, and is plain text on paper. */
function Named({ href, name }: { href: string | null; name: string }) {
  return href ? (
    <Link href={href} className="underline-offset-2 hover:underline print:no-underline">
      {name}
    </Link>
  ) : (
    name
  )
}

/** A titled table on the sheet. Columns from `figuresFrom` on are numbers, set to the right. */
function Listing({
  title,
  head,
  widths,
  rows,
  empty,
  figuresFrom,
  total,
}: {
  title: string
  head: string[]
  widths: string[]
  rows: React.ReactNode[][]
  empty: string
  figuresFrom: number
  /** A closing row of totals, when the columns add up to something worth stating. */
  total?: React.ReactNode[]
}) {
  return (
    // Short tables stay in one piece on paper; a long one is allowed to run over the page.
    <section className={`mt-6 ${rows.length <= 12 ? "bill-block" : ""}`}>
      <Caption className="pb-1">{title}</Caption>
      {rows.length === 0 ? (
        <p className="border border-(--sheet-rule) px-2.5 py-2">{empty}</p>
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="sheet-table min-w-[30rem] table-fixed print:min-w-0">
            <colgroup>
              {widths.map((width, index) => (
                <col key={index} className={width} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {head.map((text, index) => (
                  <th key={index} className={index >= figuresFrom ? "num" : undefined}>
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, index) => (
                    <td key={index} className={index >= figuresFrom ? "num" : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr>
                  {total.map((cell, index) => (
                    <td key={index} className={index >= figuresFrom ? "num" : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  )
}
