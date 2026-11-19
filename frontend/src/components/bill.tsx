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
  SheetCard,
  SheetCards,
  SheetPage,
  Signatures,
  TABLE_ONLY,
  Sum,
  SumTotal,
  Sums,
  imagesReady,
} from "@/components/paper"
import { BILL_TITLE, kindOf, monthOf, periodName, step, yearOf } from "@/lib/bills"
import { useBill } from "@/lib/data/queries"
import { count, date, money } from "@/lib/format"
import { logoUrl } from "@/lib/logo"
import { PAYMENT_METHODS } from "@/lib/rental"
import type { Bill, BillKind, BillLine, ReportRange } from "@/lib/types"
import { msg, t } from "@/lib/i18n"

const UNIT: Record<string, string> = { daily: msg("per day"), weekly: msg("per week"), monthly: msg("per month") }

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
  const totals = bill.totals
  const due = totals.closingBalance

  return (
    <>
      <SheetPage />
      <Paper>
        <PaperHeader business={bill.business} logo={logoUrl(bill.business.logoVersion)} title={t(BILL_TITLE[bill.kind])}>
          <p className="font-semibold">{periodName(bill)}</p>
          <p className="font-mono">{bill.number}</p>
          <p>{t("Issued {date}", { date: date(bill.issuedAt) })}</p>
        </PaperHeader>

        <PaperBoxes>
          <PaperBox>
            <Caption>{t("Bill to")}</Caption>
            <p className="font-bold [overflow-wrap:anywhere]">{bill.customer.company || bill.customer.name}</p>
            {bill.customer.company && <p>{bill.customer.name}</p>}
            {bill.customer.address && <p>{bill.customer.address}</p>}
            {bill.customer.phone && <p>{bill.customer.phone}</p>}
          </PaperBox>
          <PaperBox tint>
            <Caption>{due < 0 ? t("In credit") : t("Amount due")}</Caption>
            <p className="font-heading text-2xl font-bold tabular-nums">{cash(Math.abs(due))}</p>
            <p className="mt-1">
              {t("{from} to {to}", { from: date(`${bill.from}T00:00:00`), to: date(`${bill.to}T00:00:00`) })}
            </p>
          </PaperBox>
        </PaperBoxes>

        <section className="mt-5 space-y-4">
          {bill.rentals.length === 0 && (
            <p className="border border-(--sheet-rule) p-4 text-center">{t("Nothing was out on rent in this period.")}</p>
          )}
          {bill.rentals.map((rental) => (
            <div key={rental.id} className="bill-block">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1">
                <p className="font-bold">
                  <span className="font-mono">{rental.code}</span>
                  <span className="font-normal"> · {t("taken")} </span>
                  {date(rental.startedAt)}
                  <Link
                    href={`/rentals/${rental.id}/receipt`}
                    className="ml-3 text-xs font-normal underline underline-offset-2 print:hidden"
                  >
                    {t("Receipt")}
                  </Link>
                </p>
              </div>
              <SheetCards>
                {rental.lines.flatMap((line) =>
                  line.stretches.map((part, index) => (
                    <SheetCard
                      key={`${line.productName}-${index}`}
                      title={line.productName}
                      amount={cash(part.rent + part.lateFee + part.damageFee)}
                      fields={[
                        { label: t("Qty"), value: count(part.quantity) },
                        {
                          label: t("Rate"),
                          value: `${cash(line.rate)}${line.plan !== "fixed" ? ` ${t(UNIT[line.plan])}` : ""}`,
                        },
                        { label: t("Out"), value: date(part.outAt) },
                        {
                          label: t("Back"),
                          value: (
                            <>
                              {part.backAt ? date(part.backAt) : t("Still out")}
                              {part.condition === "damaged" && <span className="block font-semibold">{t("Damaged")}</span>}
                              {part.condition === "lost" && <span className="block font-semibold">{t("Not returned")}</span>}
                            </>
                          ),
                        },
                        { label: t("Days"), value: count(part.days) },
                        ...(part.daysOff > 0 ? [{ label: t("Days not charged"), value: count(part.daysOff) }] : []),
                        ...(part.lateFee > 0 ? [{ label: t("Late fee"), value: cash(part.lateFee) }] : []),
                        ...(part.damageFee > 0 ? [{ label: t("Damage"), value: cash(part.damageFee) }] : []),
                      ]}
                    />
                  )),
                )}
                {rental.discount > 0 && <Sums><Sum label={t("Discount")} value={cash(-rental.discount)} /></Sums>}
                <Sums>
                  <SumTotal label={t("Total for {code}", { code: rental.code })} value={cash(rental.total)} />
                </Sums>
              </SheetCards>
              <div className={`${TABLE_ONLY} overflow-x-auto print:overflow-visible`}>
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
                      <th>{t("Item")}</th>
                      <th className="num">{t("Qty")}</th>
                      <th>{t("Out")}</th>
                      <th>{t("Back")}</th>
                      <th className="num">{t("Days")}</th>
                      <th className="num">{t("Off")}</th>
                      <th className="num">{t("Rate")}</th>
                      <th className="num">{t("Amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rental.lines.map((line, index) => (
                      <Line key={index} line={line} cash={cash} />
                    ))}
                    {rental.discount > 0 && (
                      <tr>
                        <td colSpan={7}>{t("Discount")}</td>
                        <td className="num">{cash(-rental.discount)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} className="num">
                        {t("Total for {code}", { code: rental.code })}
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
                <Caption className="pb-1">{t("Payments received")}</Caption>
                <SheetCards>
                  {bill.payments.map((payment) => (
                    <SheetCard
                      key={payment.id}
                      title={date(payment.at)}
                      amount={cash(payment.amount)}
                      fields={[
                        { label: t("Rental"), value: <span className="font-mono">{payment.rentalCode}</span> },
                        { label: t("Paid by"), value: paidBy(payment) },
                      ]}
                    />
                  ))}
                </SheetCards>
                <table className="sheet-table hidden sm:table print:table">
                  <thead>
                    <tr>
                      <th>{t("Date")}</th>
                      <th>{t("Rental")}</th>
                      <th>{t("Paid by")}</th>
                      <th className="num">{t("Amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap">{date(payment.at)}</td>
                        <td className="font-mono">{payment.rentalCode}</td>
                        <td>{paidBy(payment)}</td>
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
            <Caption className="pb-1">{t("Summary")}</Caption>
            <Sums>
            <Sum label={t("Brought forward")} value={cash(totals.openingBalance)} />
            <Sum label={t("Rent")} value={cash(totals.rent)} />
            {totals.lateFee > 0 && <Sum label={t("Late fees")} value={cash(totals.lateFee)} />}
            {totals.damageFee > 0 && <Sum label={t("Damage and loss")} value={cash(totals.damageFee)} />}
            {totals.discount > 0 && <Sum label={t("Discount")} value={cash(-totals.discount)} />}
            <Sum label={t("Paid")} value={cash(-totals.paid)} />
            <SumTotal label={due < 0 ? t("In credit") : t("Amount due")} value={cash(Math.abs(due))} />
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
          left={t("Received by")}
          leftName={bill.customer.company || bill.customer.name}
          businessName={bill.business.name}
        />
      </Paper>
    </>
  )
}

/** "Mobile banking · TX123": the way it was paid, in words, and its reference. */
function paidBy(payment: { method: string; reference: string }) {
  const method = PAYMENT_METHODS.find((option) => option.value === payment.method)?.label ?? payment.method
  return [method && t(method), payment.reference].filter(Boolean).join(" · ") || "—"
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
            {part.backAt ? date(part.backAt) : t("Still out")}
            {part.condition === "damaged" && <p className="font-semibold">{t("Damaged")}</p>}
            {part.condition === "lost" && <p className="font-semibold">{t("Not returned")}</p>}
          </td>
          <td className="num">{count(part.days)}</td>
          <td className="num">{part.daysOff > 0 ? count(part.daysOff) : "—"}</td>
          <td className="num">
            {cash(line.rate)}
            {line.plan !== "fixed" && <span className="block text-[0.85em]">{t(UNIT[line.plan])}</span>}
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
  { id: "month", label: msg("Month") },
  { id: "year", label: msg("Year") },
  { id: "custom", label: msg("Other dates") },
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
            {t(option.label)}
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
            aria-label={t("From")}
          />
          <span className="text-muted-foreground">{t("to")}</span>
          <Input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
            className="h-9 w-auto flex-1 sm:flex-none"
            aria-label={t("To")}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label={t(kind === "year" ? msg("Previous year") : msg("Previous month"))} onClick={() => onChange(step(range, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 px-2 text-center text-sm font-medium tabular-nums">{periodName(range)}</span>
          <Button size="icon-sm" variant="outline" aria-label={t(kind === "year" ? msg("Next year") : msg("Next month"))} onClick={() => onChange(step(range, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
