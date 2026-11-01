"use client"

import { CheckCircle2, Clock, Printer, XCircle } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { ReceiptPaper } from "@/components/receipt-paper"
import { count, dateTime, money } from "@/lib/format"
import { PLAN_LABEL } from "@/lib/rental"
import type { ReceiptView } from "@/lib/receipt"

/**
 * A rental's receipt, in two copies.
 *
 * The screen copy is a proper page in the app's own colours — it is read far more often
 * than it is printed, usually by someone checking what a customer owes. The till copy is
 * the one that goes on paper: 80mm wide, solid black on white, laid out as a shop slip,
 * and sized by `ReceiptPaper` to exactly its own height so the roll doesn't feed out a
 * blank A4's worth of paper after it.
 *
 * Both are rendered from the same data, so the paper can never say something the screen
 * doesn't.
 */
export function ReceiptDocument({ receipt: r }: { receipt: ReceiptView }) {
  const cash = (value: number) => money(value, r.currency)
  const held = r.deposit - r.depositRefunded
  const rows: [string, string][] = [
    ["Date", dateTime(r.startedAt)],
    ["Customer", r.customerName],
    ...(r.customerPhone ? ([["Phone", r.customerPhone]] as [string, string][]) : []),
    ...(r.dueAt ? ([["Due back", dateTime(r.dueAt)]] as [string, string][]) : []),
    ...(r.returnedAt ? ([["All returned", dateTime(r.returnedAt)]] as [string, string][]) : []),
  ]

  return (
    <>
      <article className="rounded-xl border bg-card p-5 text-sm sm:p-6 print:hidden">
        <header className="space-y-1 border-b pb-4 text-center">
          <p className="font-heading text-lg font-semibold [overflow-wrap:anywhere]">{r.businessName}</p>
          {r.branchName && <p className="text-sm text-muted-foreground">{r.branchName}</p>}
          {r.address && <p className="text-sm text-muted-foreground">{r.address}</p>}
          {r.phone && <p className="text-sm text-muted-foreground">{r.phone}</p>}
        </header>

        <section className="flex items-center justify-between gap-3 border-b py-4">
          <div>
            <h2 className="font-heading text-xl font-semibold tracking-tight">Rental receipt</h2>
            <p className="font-mono text-sm text-muted-foreground">{r.code}</p>
          </div>
          <StateChip state={r.state} />
        </section>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b py-4">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>

        {/* Fixed layout, so a long product name wraps inside the receipt instead of making
            it wider. On a phone the rate drops under the name. */}
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Item</th>
              <th className="w-14 py-2 text-right font-medium">Out</th>
              <th className="hidden w-24 py-2 text-right font-medium sm:table-cell">Rate</th>
              <th className="w-20 py-2 text-right font-medium">Back</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-3 pr-2 font-medium [overflow-wrap:anywhere]">
                  {item.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {PLAN_LABEL[item.plan as keyof typeof PLAN_LABEL] ?? item.plan}
                    <span className="sm:hidden"> · {cash(item.rate)}</span>
                  </span>
                  {item.quantityLost > 0 && (
                    <span className="block text-xs font-normal text-destructive">
                      {count(item.quantityLost)} never came back
                    </span>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums">{count(item.quantity)}</td>
                <td className="hidden py-3 pl-2 text-right tabular-nums sm:table-cell">{cash(item.rate)}</td>
                <td className="py-3 pl-2 text-right tabular-nums">{count(item.quantityReturned)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-full max-w-64 space-y-1">
          {r.rentTotal > 0 && <Line label="Rent" value={cash(r.rentTotal)} />}
          {r.lateFee > 0 && <Line label="Late fee" value={cash(r.lateFee)} />}
          {r.damageFee > 0 && <Line label="Damage or loss" value={cash(r.damageFee)} />}
          {r.discount > 0 && <Line label="Discount" value={`− ${cash(r.discount)}`} />}
          {r.deposit > 0 && <Line label="Deposit held" value={cash(held)} />}
          <Line label="Paid" value={cash(r.paidAmount)} />
          <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
            <span>{r.balance >= 0 ? "Still to pay" : "To refund"}</span>
            <span className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{cash(Math.abs(r.balance))}</span>
          </div>
        </div>

        {r.link && (
          <div className="mt-6 flex flex-col items-center gap-2 border-t pt-5">
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={r.link} size={96} level="M" />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Scan to open this receipt, or to start the return at the counter.
            </p>
          </div>
        )}

        <footer className="mt-6 space-y-1 border-t pt-4 text-center text-xs text-muted-foreground">
          {r.note && <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">{r.note}</p>}
          <p>Thank you for renting from {r.businessName}.</p>
        </footer>
      </article>

      <ReceiptPaper>
        <TillReceipt receipt={r} rows={rows} cash={cash} held={held} />
      </ReceiptPaper>
    </>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function StateChip({ state }: { state: ReceiptView["state"] }) {
  if (state === "returned") {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-sm font-medium text-success-soft-foreground">
        <CheckCircle2 className="size-4" />
        All returned
      </p>
    )
  }
  if (state === "cancelled") {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
        <XCircle className="size-4" />
        Cancelled
      </p>
    )
  }
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2.5 py-0.5 text-sm font-medium text-info-soft-foreground">
      <Clock className="size-4" />
      Out on rent
    </p>
  )
}

/**
 * The printed copy, laid out like a shop till slip: narrow, solid black on white, with
 * each item's figures on their own line so a long name and a big amount still fit.
 */
function TillReceipt({
  receipt: r,
  rows,
  cash,
  held,
}: {
  receipt: ReceiptView
  rows: [string, string][]
  cash: (value: number) => string
  held: number
}) {
  const rule = "my-[2mm] border-t border-dashed border-black"
  return (
    <div>
      <div className="text-center">
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
              {count(item.quantity)} × {cash(item.rate)} / {PLAN_LABEL[item.plan as keyof typeof PLAN_LABEL] ?? item.plan}
            </span>
            <span className="whitespace-nowrap">{count(item.quantityReturned)} back</span>
          </div>
          {item.quantityLost > 0 && <p>{count(item.quantityLost)} NOT RETURNED</p>}
        </div>
      ))}
      <div className={rule} />
      {r.rentTotal > 0 && <TillLine label="Rent" value={cash(r.rentTotal)} />}
      {r.lateFee > 0 && <TillLine label="Late fee" value={cash(r.lateFee)} />}
      {r.damageFee > 0 && <TillLine label="Damage or loss" value={cash(r.damageFee)} />}
      {r.discount > 0 && <TillLine label="Discount" value={`- ${cash(r.discount)}`} />}
      {r.deposit > 0 && <TillLine label="Deposit held" value={cash(held)} />}
      <TillLine label="Paid" value={cash(r.paidAmount)} />
      <div className="mt-[1mm] flex justify-between text-[15px] font-bold tabular-nums">
        <span>{r.balance >= 0 ? "STILL TO PAY" : "TO REFUND"}</span>
        <span>{cash(Math.abs(r.balance))}</span>
      </div>
      {r.link && (
        <>
          <div className={rule} />
          <div className="flex flex-col items-center gap-[1mm]">
            <QRCodeSVG value={r.link} size={88} level="M" />
            <p className="text-center">Scan to see this receipt, or to return the items</p>
          </div>
        </>
      )}
      <div className={rule} />
      {r.note && <p className="text-center whitespace-pre-line [overflow-wrap:anywhere]">{r.note}</p>}
      <p className="text-center">Thank you for renting from {r.businessName}.</p>
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

/**
 * Prints the till copy.
 *
 * `window.print()` with a print stylesheet rather than generating a PDF: the counter
 * printer is already set up in the browser, and this keeps the receipt one piece of DOM
 * that stays in step with the data on screen.
 */
export function PrintButton({ label = "Print receipt" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      {label}
    </Button>
  )
}
