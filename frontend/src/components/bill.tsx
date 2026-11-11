"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Caption,
  Paper,
  PaperBox,
  PaperBoxes,
  PaperHeader,
  SheetPage,
  Signatures,
  Sum,
  SumTotal,
  Sums,
  imagesReady,
} from "@/components/paper"
import { BILL_TITLE, kindOf, monthOf, periodName, step, yearOf } from "@/lib/bills"
import { useBill } from "@/lib/data/queries"
import { count, date, money } from "@/lib/format"
import { logoUrl } from "@/lib/logo"
import type { Bill, BillKind, BillLine, ReportRange } from "@/lib/types"

const UNIT: Record<string, string> = { daily: "per day", weekly: "per week", monthly: "per month" }

/**
 * A customer's bill for a month or a year.
 *
 * One document, used for both the screen and the paper, drawn on the same sheet as a
 * receipt and a report (see `paper.tsx`): the shop's logo and name at the top, black on
 * white, A4.
 *
 * Each rental is its own block headed by its number and the day the items were taken,
 * since "when did we take these" is the first thing the customer's accounts office checks
 * a bill against. A customer who rented three times has three blocks, and on screen each
 * one links to that rental's own receipt.
 */
export function BillDocument({ bill }: { bill: Bill }) {
  const cash = (value: number) => money(value, bill.business.currency)
  const t = bill.totals
  const due = t.closingBalance

  return (
    <>
      <SheetPage />
      <Paper>
        <PaperHeader business={bill.business} logo={logoUrl(bill.business.logoVersion)} title={BILL_TITLE[bill.kind]}>
          <p className="font-semibold">{bill.label}</p>
          <p className="font-mono">{bill.number}</p>
          <p>Issued {date(bill.issuedAt)}</p>
        </PaperHeader>

        <PaperBoxes>
          <PaperBox>
            <Caption>Bill to</Caption>
            <p className="font-bold [overflow-wrap:anywhere]">{bill.customer.company || bill.customer.name}</p>
            {bill.customer.company && <p>{bill.customer.name}</p>}
            {bill.customer.address && <p>{bill.customer.address}</p>}
            {bill.customer.phone && <p>{bill.customer.phone}</p>}
          </PaperBox>
          <PaperBox tint>
            <Caption>{due < 0 ? "In credit" : "Amount due"}</Caption>
            <p className="font-heading text-2xl font-bold tabular-nums">{cash(Math.abs(due))}</p>
            <p className="mt-1">
              {date(`${bill.from}T00:00:00`)} to {date(`${bill.to}T00:00:00`)}
            </p>
          </PaperBox>
        </PaperBoxes>

        <section className="mt-5 space-y-4">
          {bill.rentals.length === 0 && (
            <p className="border border-(--sheet-rule) p-4 text-center">Nothing was out on rent in this period.</p>
          )}
          {bill.rentals.map((rental) => (
            <div key={rental.id} className="bill-block">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1">
                <p className="font-bold">
                  <span className="font-mono">{rental.code}</span>
                  <span className="font-normal"> · taken </span>
                  {date(rental.startedAt)}
                  <Link
                    href={`/rentals/${rental.id}/receipt`}
                    className="ml-3 text-xs font-normal underline underline-offset-2 print:hidden"
                  >
                    Receipt
                  </Link>
                </p>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="sheet-table min-w-[42rem] table-fixed print:min-w-0">
                  {/* Fixed widths, so the columns of one rental line up with the next. */}
                  <colgroup>
                    <col />
                    <col className="w-[7%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[14%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Qty</th>
                      <th>Out</th>
                      <th>Back</th>
                      <th className="num">Days</th>
                      <th className="num">Off</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rental.lines.map((line, index) => (
                      <Line key={index} line={line} cash={cash} />
                    ))}
                    {rental.discount > 0 && (
                      <tr>
                        <td colSpan={7}>Discount</td>
                        <td className="num">{cash(-rental.discount)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} className="num">
                        Total for {rental.code}
                      </td>
                      <td className="num">{cash(rental.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </section>

        <section className="bill-block mt-5 grid items-start gap-5 sm:grid-cols-[1fr_17rem] print:grid-cols-[1fr_17rem]">
          <div>
            {bill.payments.length > 0 && (
              <>
                <Caption className="pb-1">Payments received</Caption>
                <table className="sheet-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Rental</th>
                      <th>Paid by</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap">{date(payment.at)}</td>
                        <td className="font-mono">{payment.rentalCode}</td>
                        <td className="capitalize">
                          {[payment.method, payment.reference].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="num">{cash(payment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          {/* Headed like the payments beside it, so the two boxes start on the same line. */}
          <div>
            <Caption className="pb-1">Summary</Caption>
            <Sums>
            <Sum label="Brought forward" value={cash(t.openingBalance)} />
            <Sum label="Rent" value={cash(t.rent)} />
            {t.lateFee > 0 && <Sum label="Late fees" value={cash(t.lateFee)} />}
            {t.damageFee > 0 && <Sum label="Damage and loss" value={cash(t.damageFee)} />}
            {t.discount > 0 && <Sum label="Discount" value={cash(-t.discount)} />}
            <Sum label="Paid" value={cash(-t.paid)} />
            <SumTotal label={due < 0 ? "In credit" : "Amount due"} value={cash(Math.abs(due))} />
            </Sums>
          </div>
        </section>

        {bill.business.note && (
          <footer className="bill-block mt-5 border-t border-(--sheet-rule) pt-2 whitespace-pre-wrap">
            {bill.business.note}
          </footer>
        )}

        {/* Room to sign by hand: the customer acknowledging the bill, the owner issuing it. */}
        <Signatures
          left="Received by"
          leftName={bill.customer.company || bill.customer.name}
          businessName={bill.business.name}
        />
      </Paper>
    </>
  )
}

/**
 * Prints one customer's bill without opening it.
 *
 * The month-end list has a Print button on every row. Pressing it mounts this: the bill is
 * fetched and drawn off screen, the print dialog opens as soon as it (and the logo on it)
 * is ready, and `onDone` unmounts it when the dialog closes. Nothing shows on screen; on
 * paper it is exactly the sheet the bill's own page prints.
 */
export function PrintBill({ customerId, range, onDone }: { customerId: string; range: ReportRange; onDone: () => void }) {
  const { data: bill, isError } = useBill(customerId, range)
  const sheet = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    if (isError) done.current()
  }, [isError])

  useEffect(() => {
    if (!bill) return
    let cancelled = false
    const finish = () => done.current()
    window.addEventListener("afterprint", finish)
    void imagesReady(sheet.current).then(() => {
      if (!cancelled) window.print()
    })
    return () => {
      cancelled = true
      window.removeEventListener("afterprint", finish)
    }
  }, [bill])

  return (
    <div ref={sheet} className="hidden print:block">
      {bill && <BillDocument bill={bill} />}
    </div>
  )
}

/**
 * One product on one rental, a row for each group of units that share their dates: what
 * went out, when, when it came back, how many days that was and how many were not charged.
 * These are the figures a customer checks against their own gate register.
 */
function Line({ line, cash }: { line: BillLine; cash: (value: number) => string }) {
  return (
    <>
      {line.stretches.map((part, index) => (
        <tr key={index}>
          <td>{index === 0 && line.productName}</td>
          <td className="num">{count(part.quantity)}</td>
          <td className="whitespace-nowrap">{date(part.outAt)}</td>
          <td className="whitespace-nowrap">
            {part.backAt ? date(part.backAt) : "Still out"}
            {part.condition === "damaged" && <p className="font-semibold">Damaged</p>}
            {part.condition === "lost" && <p className="font-semibold">Not returned</p>}
          </td>
          <td className="num">{count(part.days)}</td>
          <td className="num">{part.daysOff > 0 ? count(part.daysOff) : "—"}</td>
          <td className="num">
            {cash(line.rate)}
            {line.plan !== "fixed" && <span className="block text-[0.85em]">{UNIT[line.plan]}</span>}
          </td>
          <td className="num">
            {cash(part.rent)}
            {part.lateFee > 0 && <span className="block text-[0.85em]">+ late {cash(part.lateFee)}</span>}
            {part.damageFee > 0 && <span className="block text-[0.85em]">+ damage {cash(part.damageFee)}</span>}
          </td>
        </tr>
      ))}
    </>
  )
}

const KINDS: { id: BillKind; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Other dates" },
]

/**
 * Which period to bill.
 *
 * Month and year are one tap, with arrows to walk back through earlier ones — sending last
 * month's bill is the usual job. "Other dates" is there for the customer who closes their
 * account on the 14th.
 */
export function PeriodPicker({ range, onChange }: { range: ReportRange; onChange: (range: ReportRange) => void }) {
  // "Other dates" is a mode of the picker, not a property of the dates: someone typing
  // 1–30 November by hand should keep their date boxes rather than be flipped to "Month".
  const [typing, setTyping] = useState(() => kindOf(range) === "custom")
  const kind: BillKind = typing ? "custom" : kindOf(range)

  function pick(next: BillKind) {
    setTyping(next === "custom")
    if (next === "month") onChange(monthOf(kindOf(range) === "month" ? new Date(`${range.from}T00:00:00`) : new Date()))
    if (next === "year") onChange(yearOf(new Date(`${range.from}T00:00:00`)))
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex gap-1">
        {KINDS.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={kind === option.id ? "default" : "outline"}
            onClick={() => pick(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {kind === "custom" ? (
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
      ) : (
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label={`Previous ${kind}`} onClick={() => onChange(step(range, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 px-2 text-center text-sm font-medium tabular-nums">{periodName(range)}</span>
          <Button size="icon-sm" variant="outline" aria-label={`Next ${kind}`} onClick={() => onChange(step(range, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
