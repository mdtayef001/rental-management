"use client"

import { QRCodeSVG } from "qrcode.react"
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
} from "@/components/paper"
import { ReceiptPaper } from "@/components/receipt-paper"
import { count, date, dateTime, money, plural } from "@/lib/format"
import { DevixSlipCredit } from "@/components/devix"
import { cn } from "@/lib/utils"
import { RECEIPT_STATE, receiptEstimate, receiptSums, returnedLateDays, type ReceiptView } from "@/lib/receipt"
import { msg, t } from "@/lib/i18n"

const UNIT: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" }
const PER: Record<string, string> = { daily: msg("per day"), weekly: msg("per week"), monthly: msg("per month") }

/**
 * One rental's receipt.
 *
 * Every rental has its own: a customer who rents twice in a week gets two receipts with
 * two numbers, and each is settled on its own. It is drawn on the same sheet as a bill —
 * the shop's logo and name at the top, black on white — so everything the shop hands over
 * looks like it came from the same place.
 *
 * There are two paper copies of the same data. The sheet is A4, the one to hand a company
 * or file. The slip is 80mm, for a till printer. `paper` says which one goes on paper;
 * the screen always shows the sheet.
 */
export function ReceiptDocument({ receipt: r, paper = "sheet" }: { receipt: ReceiptView; paper?: "sheet" | "slip" }) {
  const cash = (value: number) => money(value, r.currency)
  const sums = receiptSums(r)
  const est = receiptEstimate(r)
  const cameBackLate = returnedLateDays(r)

  return (
    <>
      {paper === "sheet" && <SheetPage />}
      <Paper className={paper === "slip" ? "print:hidden" : undefined}>
        <PaperHeader
          business={{ name: r.businessName, address: r.address, phone: r.phone }}
          logo={r.logo}
          title={t("Rental receipt")}
        >
          <p className="font-mono font-semibold">{r.code}</p>
          <p>{date(r.startedAt)}</p>
          <p className="mt-1 inline-block border border-(--sheet-line) px-2 py-0.5 text-[0.9em] font-bold uppercase">
            {t(RECEIPT_STATE[r.state])}
          </p>
        </PaperHeader>

        <PaperBoxes className="sm:grid-cols-3 print:grid-cols-3">
          <PaperBox>
            <Caption>{t("Rented to")}</Caption>
            <p className="font-bold [overflow-wrap:anywhere]">{r.customerName}</p>
            {r.customerPhone && <p>{r.customerPhone}</p>}
          </PaperBox>
          <PaperBox>
            <Caption>{t("Taken")}</Caption>
            <p>{dateTime(r.startedAt)}</p>
          </PaperBox>
          <PaperBox>
            {/* The date agreed is always shown when there is one: it is what the hire was
                priced on, and what "late" is measured from. */}
            <Caption>{t("Due back")}</Caption>
            <p>{r.dueAt ? dateTime(r.dueAt) : t("No fixed date")}</p>
            {est.overdueDays > 0 && <p className="font-bold">{t("Overdue {days}", { days: plural(est.overdueDays, "day") })}</p>}
            {r.returnedAt && (
              <>
                <Caption className="mt-2">{t("Returned")}</Caption>
                <p>{dateTime(r.returnedAt)}</p>
                {cameBackLate > 0 && <p className="font-bold">{t("{days} late", { days: plural(cameBackLate, "day") })}</p>}
              </>
            )}
          </PaperBox>
        </PaperBoxes>

        <section className="bill-block mt-5">
          <SheetCards>
            {r.items.map((item, index) => {
              const running = est.lines[index]
              const charged = item.lineTotal + running.rent + running.lateFee
              return (
                <SheetCard
                  key={index}
                  title={item.name}
                  amount={charged > 0 ? cash(charged) : "—"}
                  fields={[
                    { label: t("Taken"), value: count(item.quantity) },
                    { label: t("Back"), value: count(item.quantityReturned) },
                    {
                      label: t("Rate"),
                      value: `${cash(item.rate)}${item.plan !== "fixed" ? ` ${t(PER[item.plan])}` : ""}`,
                    },
                    {
                      label: t("Days"),
                      value: running.out > 0 ? count(est.days) : item.daysOut ? count(item.daysOut) : "—",
                    },
                    ...(item.quantityLost > 0
                      ? [{ label: t("Not returned"), value: <strong>{count(item.quantityLost)}</strong> }]
                      : []),
                  ]}
                />
              )
            })}
          </SheetCards>
          <div className={`${TABLE_ONLY} overflow-x-auto print:overflow-visible`}>
            <table className="sheet-table min-w-[34rem] table-fixed print:min-w-0">
              <colgroup>
                <col />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t("Item")}</th>
                  <th className="num">{t("Taken")}</th>
                  <th className="num">{t("Back")}</th>
                  <th className="num">{t("Rate")}</th>
                  <th className="num">{t("Days")}</th>
                  <th className="num">{t("Charged")}</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((item, index) => {
                  const running = est.lines[index]
                  const charged = item.lineTotal + running.rent + running.lateFee
                  return (
                  <tr key={index}>
                    <td>
                      {item.name}
                      {item.quantityLost > 0 && <p className="font-bold">{t("{count} not returned", { count: count(item.quantityLost) })}</p>}
                    </td>
                    <td className="num">{count(item.quantity)}</td>
                    <td className="num">{count(item.quantityReturned)}</td>
                    <td className="num">
                      {cash(item.rate)}
                      {item.plan !== "fixed" && <span className="block text-[0.85em]">{t(PER[item.plan])}</span>}
                    </td>
                    <td className="num">
                      {running.out > 0 ? count(est.days) : item.daysOut ? count(item.daysOut) : "—"}
                    </td>
                    <td className="num">{charged > 0 ? cash(charged) : "—"}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bill-block mt-5 flex flex-col-reverse gap-5 sm:flex-row sm:items-end sm:justify-between print:flex-row print:items-end print:justify-between">
          {r.link ? (
            <div className="flex items-center gap-3">
              <QRCodeSVG value={r.link} size={92} level="M" marginSize={0} />
              <p className="font-semibold">{t("Scan to return")}</p>
            </div>
          ) : (
            <span />
          )}
          <Sums className="w-full sm:w-[17rem] print:w-[17rem]">
            {(r.rentTotal > 0 || !est.running) && (
              <Sum label={est.running ? t("Rent on items returned") : t("Rent")} value={cash(r.rentTotal)} />
            )}
            {est.running && <Sum label={runningLabel(r, est)} value={cash(est.rent)} />}
            {r.lateFee > 0 && <Sum label={t("Late fee")} value={cash(r.lateFee)} />}
            {est.lateFee > 0 && (
              <Sum label={`${t("Late fee so far")} · ${plural(est.overdueDays, "day")}`} value={cash(est.lateFee)} />
            )}
            {r.damageFee > 0 && <Sum label={t("Damage and loss")} value={cash(r.damageFee)} />}
            {r.discount > 0 && <Sum label={t("Discount")} value={cash(-r.discount)} />}
            {r.advancePaid > 0 && <Sum label={t("Paid in advance")} value={cash(-r.advancePaid)} />}
            {sums.paidLater > 0 && <Sum label={t("Paid")} value={cash(-sums.paidLater)} />}
            {r.refunded > 0 && <Sum label={t("Given back")} value={cash(r.refunded)} />}
            <SumTotal label={closingLabel(sums.closing, est)} value={cash(Math.abs(est.balance))} />
          </Sums>
        </section>

        {r.note && (
          <footer className="bill-block mt-5 border-t border-(--sheet-rule) pt-2 whitespace-pre-wrap">{r.note}</footer>
        )}

        <Signatures left={t("Received by")} leftName={r.customerName} businessName={r.businessName} />
      </Paper>

      <ReceiptPaper active={paper === "slip"}>
        <TillReceipt receipt={r} cash={cash} />
      </ReceiptPaper>
    </>
  )
}

type Estimate = ReturnType<typeof receiptEstimate>

/** "Rent to 19 Nov 2026 · 14 days" while the date is ahead, "Rent so far · 31 days" after. */
function runningLabel(r: ReceiptView, est: Estimate) {
  return est.toDue && r.dueAt
    ? `${t("Rent to {date}", { date: date(r.dueAt) })} · ${plural(est.days, "day")}`
    : `${t("Rent so far")} · ${plural(est.days, "day")}`
}

/** The last line's name. While items are out the figure is still moving, and says so. */
function closingLabel(settled: string, est: Estimate) {
  if (!est.running) return t(settled)
  return est.balance < 0 ? t("In credit so far") : est.toDue ? t("To pay by return") : t("To pay so far")
}

/**
 * The till-printer copy, laid out like a shop slip: narrow, solid black on white, with
 * each item's figures on their own line so a long name and a big amount still fit.
 */
function TillReceipt({ receipt: r, cash }: { receipt: ReceiptView; cash: (value: number) => string }) {
  const rule = "my-[2mm] border-t-2 border-black"
  const sums = receiptSums(r)
  const est = receiptEstimate(r)
  const cameBackLate = returnedLateDays(r)
  const rows: [string, string][] = [
    [t("Date"), dateTime(r.startedAt)],
    [t("Customer"), r.customerName],
    ...(r.customerPhone ? ([[t("Phone"), r.customerPhone]] as [string, string][]) : []),
    ...(r.dueAt ? ([[t("Due back"), dateTime(r.dueAt)]] as [string, string][]) : []),
    ...(est.overdueDays > 0 ? ([[t("OVERDUE"), plural(est.overdueDays, "day")]] as [string, string][]) : []),
    ...(r.returnedAt ? ([[t("All returned"), dateTime(r.returnedAt)]] as [string, string][]) : []),
    ...(cameBackLate > 0 ? ([[t("Returned late"), plural(cameBackLate, "day")]] as [string, string][]) : []),
  ]
  return (
    <div>
      <div className="text-center">
        {r.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- must print, and is already small
          <img src={r.logo} alt="" className="mx-auto mb-[1mm] max-h-[14mm] max-w-[50mm] object-contain" />
        )}
        <p className="text-[1.3em] leading-tight font-bold">{r.businessName}</p>
        {r.address && <p>{r.address}</p>}
        {r.phone && <p>{r.phone}</p>}
      </div>
      <div className={rule} />
      <TillLine
        label={<span className="text-[1.15em] font-bold">
          {r.state === "returned" ? t("RECEIPT · RETURNED") : r.state === "cancelled" ? t("RECEIPT · CANCELLED") : t("RECEIPT")}
        </span>}
        value={<span className="font-mono">{r.code}</span>}
      />
      {rows.map(([label, value]) => (
        <TillLine key={label} label={label} value={value} detail />
      ))}
      <div className={rule} />
      {r.items.map((item, i) => {
        const running = est.lines[i]
        const charged = item.lineTotal + running.rent + running.lateFee
        return (
          <div key={i} className="mb-[1.5mm] last:mb-0">
            <p className="font-bold [overflow-wrap:anywhere]">{item.name}</p>
            <TillLine
              label={`${count(item.quantity)} × ${cash(item.rate)}${item.plan !== "fixed" ? ` / ${t(UNIT[item.plan])}` : ""}`}
              value={charged > 0 ? cash(charged) : "—"}
            />
            <p className="text-[0.88em]">
              {t("{count} back", { count: count(item.quantityReturned) })}
              {item.quantityLost > 0 && ` · ${t("{count} NOT RETURNED", { count: count(item.quantityLost) })}`}
            </p>
          </div>
        )
      })}
      <div className={rule} />
      {r.rentTotal > 0 && <TillLine label={est.running ? t("Rent, returned") : t("Rent")} value={cash(r.rentTotal)} />}
      {est.running && <TillLine label={runningLabel(r, est)} value={cash(est.rent)} />}
      {r.lateFee > 0 && <TillLine label={t("Late fee")} value={cash(r.lateFee)} />}
      {est.lateFee > 0 && <TillLine label={t("Late fee so far")} value={cash(est.lateFee)} />}
      {r.damageFee > 0 && <TillLine label={t("Damage or loss")} value={cash(r.damageFee)} />}
      {/* What comes off is written as a minus, the same way every time, so the figures
          read straight down one column. */}
      {r.discount > 0 && <TillLine label={t("Discount")} value={cash(-r.discount)} />}
      {r.advancePaid > 0 && <TillLine label={t("Paid in advance")} value={cash(-r.advancePaid)} />}
      {sums.paidLater > 0 && <TillLine label={t("Paid")} value={cash(-sums.paidLater)} />}
      {r.refunded > 0 && <TillLine label={t("Given back")} value={cash(r.refunded)} />}
      <div className="mt-[1mm] border-t-2 border-black pt-[1mm] text-[1.2em] font-bold">
        <TillLine label={closingLabel(sums.closing, est).toUpperCase()} value={cash(Math.abs(est.balance))} />
      </div>
      {r.link && (
        <>
          <div className={rule} />
          <div className="flex flex-col items-center gap-[1mm]">
            <QRCodeSVG value={r.link} size={88} level="M" style={{ width: "22mm", height: "22mm" }} />
            <p className="text-center font-bold">{t("Scan to return")}</p>
          </div>
        </>
      )}
      <div className={rule} />
      {r.note && <p className="text-center whitespace-pre-line [overflow-wrap:anywhere]">{r.note}</p>}
      <p className="text-center">{t("Thank you.")}</p>
      <div className={rule} />
      <DevixSlipCredit />
    </div>
  )
}

/**
 * One line of the slip: what it is on the left, its figure on the right.
 *
 * Every line shares the same two columns. The figure never wraps and is set flush right in
 * tabular digits, so all the amounts end in one straight edge; a long label wraps inside
 * its own column instead of pushing its figure out of line.
 */
function TillLine({
  label,
  value,
  detail,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** A fact rather than a figure — a customer's name, a date — which may need to wrap. */
  detail?: boolean
}) {
  return (
    <div
      className={cn(
        "grid items-baseline gap-x-[3mm] tabular-nums",
        detail ? "grid-cols-[auto_1fr]" : "grid-cols-[1fr_auto]",
      )}
    >
      <span className={detail ? "whitespace-nowrap" : "min-w-0 [overflow-wrap:anywhere]"}>{label}</span>
      <span className={cn("text-right", detail ? "min-w-0 [overflow-wrap:anywhere]" : "whitespace-nowrap")}>{value}</span>
    </div>
  )
}
