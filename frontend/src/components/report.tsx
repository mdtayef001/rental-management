"use client"

import Link from "next/link"
import { Caption, Paper, PaperHeader, SheetCard, SheetCards, SheetPage, Sum, SumTotal, Sums, TABLE_ONLY } from "@/components/paper"
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
import { msg, t } from "@/lib/i18n"

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
  const groupName = { day: t("Day"), week: t("Week starting"), month: t("Month") }[report.group]

  return (
    <>
      <SheetPage />
      <Paper>
        <PaperHeader business={business} logo={logo} title={t("Business report")}>
          <p className="font-semibold">{rangeLabel(report.range)}</p>
          <p>{t("Printed {date}", { date: date(new Date()) })}</p>
        </PaperHeader>

        {/* The four figures an owner asks for first, ruled as one table. */}
        <section className="mt-5 grid grid-cols-2 border-t border-l border-(--sheet-line) sm:grid-cols-4 print:grid-cols-4">
          <Figure label={t("Earned")} value={cash(s.revenue)} />
          <Figure label={t("Money received")} value={cash(s.collected - s.refunded)} />
          <Figure label={t("Owed by customers")} value={cash(s.outstanding)} />
          <Figure
            label={t("Out on rent")}
            value={t("{count} units", { count: count(s.unitsOut) })}
            note={t("{rentals} rentals, {overdue} overdue", { rentals: count(s.openRentals), overdue: count(s.overdue) })}
          />
        </section>

        <section className="bill-block mt-5 grid items-start gap-5 sm:grid-cols-2 print:grid-cols-2">
          <div>
            <Caption className="pb-1">{t("Earned")}</Caption>
            <Sums>
              <Sum label={t("Rent")} value={cash(s.rent)} />
              {s.lateFees > 0 && <Sum label={t("Late fees")} value={cash(s.lateFees)} />}
              {s.damageFees > 0 && <Sum label={t("Damage and loss")} value={cash(s.damageFees)} />}
              {s.discounts > 0 && <Sum label={t("Discounts given")} value={cash(-s.discounts)} />}
              <SumTotal label={t("Total earned")} value={cash(s.revenue)} />
            </Sums>
            {s.advancesHeld > 0 && (
              <Sums className="mt-2">
                <Sum label={t("Advances held, not yet earned")} value={cash(s.advancesHeld)} />
              </Sums>
            )}
          </div>
          <div>
            <Caption className="pb-1">{t("Activity")}</Caption>
            <Sums>
              <Sum label={t("Rentals started")} value={count(s.rentals)} />
              <Sum label={t("Units sent out")} value={count(s.unitsRented)} />
              <Sum label={t("Units returned")} value={count(s.unitsReturned)} />
              <Sum label={t("Returns taken")} value={count(s.returns)} />
              <Sum label={t("New customers")} value={count(s.newCustomers)} />
              {s.unitsDamaged > 0 && <Sum label={t("Returned damaged")} value={count(s.unitsDamaged)} />}
              {s.unitsLost > 0 && <Sum label={t("Never returned")} value={count(s.unitsLost)} />}
            </Sums>
          </div>
        </section>

        {/* One row for each thing that came back: the day, who brought it, and which
            product, so any figure here can be traced to a rental. */}
        <Listing
          title={t({ day: msg("Earned per day"), week: msg("Earned per week"), month: msg("Earned per month") }[report.group])}
          empty={t("Nothing was earned in this period.")}
          head={[groupName, t("Customer"), t("Product"), t("SKU / barcode"), t("Units"), t("Earned")]}
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
            ...(row.discounts > 0 ? [["", t("Discount"), "", "", "", cash(-row.discounts)]] : []),
          ])}
          total={[
            t("Total"),
            "",
            "",
            "",
            count(report.revenue.reduce((sum, row) => sum + row.details.reduce((n, line) => n + line.units, 0), 0)),
            cash(report.revenue.reduce((sum, row) => sum + row.revenue, 0)),
          ]}
        />

        <Listing
          title={t("Top products")}
          empty={t("No items came back in this period.")}
          head={[t("Product"), t("Rentals"), t("Units"), t("Earned")]}
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
          title={t("Top customers")}
          empty={t("Nobody returned anything in this period.")}
          head={[t("Customer"), t("Rentals"), t("Spent"), t("Still owes")]}
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
          title={t("Who owes you")}
          empty={t("Nobody owes anything.")}
          head={[t("Customer"), t("Phone"), t("Still out"), t("Owes")]}
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
        <>
          {/* On a phone each row is a card: the first column names it, the last is its
              figure, and the columns between are labelled underneath. */}
          <SheetCards>
            {rows.map((row, r) => {
              // A row that runs on from the one above has no first cell: its second names it.
              const from = row[0] ? 1 : 2
              const last = row[row.length - 1]
              return (
                <SheetCard
                  key={r}
                  title={row[0] || row[1]}
                  amount={last === "—" ? undefined : last}
                  fields={row
                    .slice(from, -1)
                    .map((value, index) => ({ label: head[index + from], value }))
                    .filter((field) => field.value !== "" && field.value !== "—")}
                />
              )
            })}
            {total && (
              <Sums>
                <SumTotal label={String(total[0])} value={String(total[total.length - 1])} />
              </Sums>
            )}
          </SheetCards>
        <div className={`${TABLE_ONLY} overflow-x-auto print:overflow-visible`}>
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
        </>
      )}
    </section>
  )
}
