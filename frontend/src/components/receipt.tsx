"use client"

import { QRCodeSVG } from "qrcode.react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { count, dateTime, money } from "@/lib/format"
import { PLAN_LABEL } from "@/lib/rental"
import type { Business, Rental } from "@/lib/types"

/**
 * The printable receipt.
 *
 * Laid out for 80mm thermal paper, which is what a counter printer takes, and still
 * readable on A4. The QR code carries the public receipt link: the customer can open it on
 * their phone, and scanning it on the Take back screen opens this exact rental — which is
 * the quickest possible way to start a return.
 */
export function Receipt({ rental, business, branchName }: { rental: Rental; business: Business | null; branchName?: string }) {
  const currency = business?.settings.currency ?? "BDT"
  const link = rental.token ? `${typeof window !== "undefined" ? window.location.origin : ""}/r/${rental.token}` : null

  return (
    <div className="receipt mx-auto max-w-[80mm] space-y-3 bg-white p-4 text-[11px] leading-snug text-black">
      <header className="space-y-0.5 text-center">
        <h1 className="text-base font-bold">{business?.name ?? "Rental"}</h1>
        {branchName && <div>{branchName}</div>}
        {business?.address && <div>{business.address}</div>}
        {business?.phone && <div>{business.phone}</div>}
      </header>

      <div className="border-y border-dashed border-black py-2">
        <Row label="Receipt" value={rental.code} bold />
        <Row label="Date" value={dateTime(rental.startedAt)} />
        <Row label="Customer" value={rental.customerName} />
        {rental.customerPhone && <Row label="Phone" value={rental.customerPhone} />}
        {rental.dueAt && <Row label="Due back" value={dateTime(rental.dueAt)} />}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="pb-1 font-semibold">Item</th>
            <th className="pb-1 text-right font-semibold">Qty</th>
            <th className="pb-1 text-right font-semibold">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rental.items?.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-1 pr-1">
                {item.productName}
                <div className="text-[10px] opacity-70">{PLAN_LABEL[item.plan]}</div>
              </td>
              <td className="py-1 text-right tabular-nums">{count(item.quantity)}</td>
              <td className="py-1 text-right tabular-nums">{money(item.rate, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-0.5 border-t border-dashed border-black pt-2">
        {rental.rentTotal > 0 && <Row label="Rent charged" value={money(rental.rentTotal, currency)} />}
        {rental.lateFee > 0 && <Row label="Late fee" value={money(rental.lateFee, currency)} />}
        {rental.damageFee > 0 && <Row label="Damage" value={money(rental.damageFee, currency)} />}
        {rental.discount > 0 && <Row label="Discount" value={`− ${money(rental.discount, currency)}`} />}
        {rental.deposit > 0 && <Row label="Deposit held" value={money(rental.deposit - rental.depositRefunded, currency)} />}
        <Row label="Paid" value={money(rental.paidAmount, currency)} />
        <Row
          label={rental.balance >= 0 ? "Balance due" : "To refund"}
          value={money(Math.abs(rental.balance), currency)}
          bold
        />
      </div>

      {link && (
        <div className="flex flex-col items-center gap-1 border-t border-dashed border-black pt-3">
          <QRCodeSVG value={link} size={88} level="M" />
          <div className="text-center text-[10px]">Scan to see this receipt, or to return the items</div>
        </div>
      )}

      {business?.settings.receiptNote && (
        <p className="border-t border-dashed border-black pt-2 text-center text-[10px]">
          {business.settings.receiptNote}
        </p>
      )}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Prints whatever is inside `.receipt`.
 *
 * `window.print()` with a print stylesheet rather than generating a PDF: a counter printer
 * is already set up in the browser, and this keeps the receipt a single DOM node that
 * stays in step with the data on screen.
 */
export function PrintButton({ label = "Print receipt" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      {label}
    </Button>
  )
}
