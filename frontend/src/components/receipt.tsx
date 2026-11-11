"use client"

import { QRCodeSVG } from "qrcode.react"
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
} from "@/components/paper"
import { ReceiptPaper } from "@/components/receipt-paper"
import { count, date, dateTime, money, plural } from "@/lib/format"
import { RECEIPT_STATE, receiptEstimate, receiptSums, returnedLateDays, type ReceiptView } from "@/lib/receipt"

const UNIT: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" }
const PER: Record<string, string> = { daily: "per day", weekly: "per week", monthly: "per month" }

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
          business={{ name: r.businessName, branch: r.branchName, address: r.address, phone: r.phone }}
          logo={r.logo}
          title="Rental receipt"
        >
          <p className="font-mono font-semibold">{r.code}</p>
          <p>{date(r.startedAt)}</p>
          <p className="mt-1 inline-block border border-(--sheet-line) px-2 py-0.5 text-[0.9em] font-bold uppercase">
            {RECEIPT_STATE[r.state]}
          </p>
        </PaperHeader>

        <PaperBoxes className="sm:grid-cols-3 print:grid-cols-3">
          <PaperBox>
            <Caption>Rented to</Caption>
            <p className="font-bold [overflow-wrap:anywhere]">{r.customerName}</p>
            {r.customerPhone && <p>{r.customerPhone}</p>}
          </PaperBox>
          <PaperBox>
            <Caption>Taken</Caption>
            <p>{dateTime(r.startedAt)}</p>
          </PaperBox>
          <PaperBox>
            {/* The date agreed is always shown when there is one: it is what the hire was
                priced on, and what "late" is measured from. */}
            <Caption>Due back</Caption>
            <p>{r.dueAt ? dateTime(r.dueAt) : "No fixed date"}</p>
            {est.overdueDays > 0 && <p className="font-bold">Overdue {plural(est.overdueDays, "day")}</p>}
            {r.returnedAt && (
              <>
                <Caption className="mt-2">Returned</Caption>
                <p>{dateTime(r.returnedAt)}</p>
                {cameBackLate > 0 && <p className="font-bold">{plural(cameBackLate, "day")} late</p>}
              </>
            )}
          </PaperBox>
        </PaperBoxes>

        <section className="bill-block mt-5">
          <div className="overflow-x-auto print:overflow-visible">
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
                  <th>Item</th>
                  <th className="num">Taken</th>
                  <th className="num">Back</th>
                  <th className="num">Rate</th>
                  <th className="num">Days</th>
                  <th className="num">Charged</th>
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
                      {item.quantityLost > 0 && <p className="font-bold">{count(item.quantityLost)} not returned</p>}
                    </td>
                    <td className="num">{count(item.quantity)}</td>
                    <td className="num">{count(item.quantityReturned)}</td>
                    <td className="num">
                      {cash(item.rate)}
                      {item.plan !== "fixed" && <span className="block text-[0.85em]">{PER[item.plan]}</span>}
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
              <p className="font-semibold">Scan to return</p>
            </div>
          ) : (
            <span />
          )}
          <Sums className="w-full sm:w-[17rem] print:w-[17rem]">
            {(r.rentTotal > 0 || !est.running) && (
              <Sum label={est.running ? "Rent on items returned" : "Rent"} value={cash(r.rentTotal)} />
            )}
            {est.running && <Sum label={runningLabel(r, est)} value={cash(est.rent)} />}
            {r.lateFee > 0 && <Sum label="Late fee" value={cash(r.lateFee)} />}
            {est.lateFee > 0 && (
              <Sum label={`Late fee so far · ${plural(est.overdueDays, "day")}`} value={cash(est.lateFee)} />
            )}
            {r.damageFee > 0 && <Sum label="Damage and loss" value={cash(r.damageFee)} />}
            {r.discount > 0 && <Sum label="Discount" value={cash(-r.discount)} />}
            {r.advancePaid > 0 && <Sum label="Paid in advance" value={cash(-r.advancePaid)} />}
            {sums.paidLater > 0 && <Sum label="Paid" value={cash(-sums.paidLater)} />}
            {r.refunded > 0 && <Sum label="Given back" value={cash(r.refunded)} />}
            <SumTotal label={closingLabel(sums.closing, est)} value={cash(Math.abs(est.balance))} />
          </Sums>
        </section>

        {r.note && (
          <footer className="bill-block mt-5 border-t border-(--sheet-rule) pt-2 whitespace-pre-wrap">{r.note}</footer>
        )}

        <Signatures left="Received by" leftName={r.customerName} businessName={r.businessName} />
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
    ? `Rent to ${date(r.dueAt)} · ${plural(est.days, "day")}`
    : `Rent so far · ${plural(est.days, "day")}`
}

/** The last line's name. While items are out the figure is still moving, and says so. */
function closingLabel(settled: string, est: Estimate) {
  if (!est.running) return settled
  return est.balance < 0 ? "In credit so far" : est.toDue ? "To pay by return" : "To pay so far"
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
    ["Date", dateTime(r.startedAt)],
    ["Customer", r.customerName],
    ...(r.customerPhone ? ([["Phone", r.customerPhone]] as [string, string][]) : []),
    ...(r.dueAt ? ([["Due back", dateTime(r.dueAt)]] as [string, string][]) : []),
    ...(est.overdueDays > 0 ? ([["OVERDUE", plural(est.overdueDays, "day")]] as [string, string][]) : []),
    ...(r.returnedAt ? ([["All returned", dateTime(r.returnedAt)]] as [string, string][]) : []),
    ...(cameBackLate > 0 ? ([["Returned late", plural(cameBackLate, "day")]] as [string, string][]) : []),
  ]
  return (
    <div>
      <div className="text-center">
        {r.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- must print, and is already small
          <img src={r.logo} alt="" className="mx-auto mb-[1mm] max-h-[14mm] max-w-[50mm] object-contain" />
        )}
        <p className="text-[16px] leading-tight font-bold">{r.businessName}</p>
        {r.branchName && <p>{r.branchName}</p>}
        {r.address && <p>{r.address}</p>}
        {r.phone && <p>{r.phone}</p>}
      </div>
      <div className={rule} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold">
          {r.state === "returned" ? "RECEIPT · RETURNED" : r.state === "cancelled" ? "RECEIPT · CANCELLED" : "RECEIPT"}
        </span>
        <span className="font-mono">{r.code}</span>
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="shrink-0">{label}</span>
          <span className="text-right break-words">{value}</span>
        </div>
      ))}
      <div className={rule} />
      {r.items.map((item, i) => (
        <div key={i} className="mb-[1mm]">
          <p className="font-bold break-words">{item.name}</p>
          <div className="flex justify-between gap-2 tabular-nums">
            <span>
              {count(item.quantity)} × {cash(item.rate)}
              {item.plan !== "fixed" && ` / ${UNIT[item.plan]}`}
            </span>
            <span className="whitespace-nowrap">{count(item.quantityReturned)} back</span>
          </div>
          {item.quantityLost > 0 && <p>{count(item.quantityLost)} NOT RETURNED</p>}
        </div>
      ))}
      <div className={rule} />
      {r.rentTotal > 0 && <TillLine label={est.running ? "Rent, returned" : "Rent"} value={cash(r.rentTotal)} />}
      {est.running && <TillLine label={runningLabel(r, est)} value={cash(est.rent)} />}
      {r.lateFee > 0 && <TillLine label="Late fee" value={cash(r.lateFee)} />}
      {est.lateFee > 0 && <TillLine label="Late fee so far" value={cash(est.lateFee)} />}
      {r.damageFee > 0 && <TillLine label="Damage or loss" value={cash(r.damageFee)} />}
      {r.discount > 0 && <TillLine label="Discount" value={`- ${cash(r.discount)}`} />}
      {r.advancePaid > 0 && <TillLine label="Paid in advance" value={cash(r.advancePaid)} />}
      {sums.paidLater > 0 && <TillLine label="Paid" value={cash(sums.paidLater)} />}
      {r.refunded > 0 && <TillLine label="Given back" value={cash(r.refunded)} />}
      <div className="mt-[1mm] flex justify-between border-t-2 border-black pt-[1mm] text-[15px] font-bold tabular-nums">
        <span>{closingLabel(sums.closing, est).toUpperCase()}</span>
        <span>{cash(Math.abs(est.balance))}</span>
      </div>
      {r.link && (
        <>
          <div className={rule} />
          <div className="flex flex-col items-center gap-[1mm]">
            <QRCodeSVG value={r.link} size={88} level="M" />
            <p className="text-center font-bold">Scan to return</p>
          </div>
        </>
      )}
      <div className={rule} />
      {r.note && <p className="text-center whitespace-pre-line [overflow-wrap:anywhere]">{r.note}</p>}
      <p className="text-center">Thank you.</p>
    </div>
  )
}

function TillLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 tabular-nums">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
