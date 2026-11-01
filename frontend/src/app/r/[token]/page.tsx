import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS } from "@/lib/api/errors"
import { count, dateTime, money } from "@/lib/format"

export const metadata: Metadata = {
  title: "Your receipt",
  // A receipt is somebody's private record; it should never turn up in a search engine.
  robots: { index: false, follow: false },
}

interface Receipt {
  business: { name: string; phone: string; address: string; currency: string; receiptNote: string }
  branch: { name: string; phone: string; address: string } | null
  rental: {
    code: string
    status: string
    customerName: string
    startedAt: string
    dueAt: string | null
    returnedAt: string | null
    deposit: number
    depositRefunded: number
    rentTotal: number
    lateFee: number
    damageFee: number
    discount: number
    paidAmount: number
    charges: number
    balance: number
    notes: string
  }
  items: {
    productName: string
    quantity: number
    quantityReturned: number
    quantityLost: number
    plan: string
    rate: number
    daysOut: number | null
    lineTotal: number
  }[]
  returns: {
    code: string
    at: string
    rentTotal: number
    lateFee: number
    damageFee: number
    discount: number
    paidAmount: number
    depositRefunded: number
    lines: { productName: string; quantity: number; condition: string; daysOut: number }[]
  }[]
  highlightReturn: string | null
}

/**
 * The receipt a customer opens from the QR code on their printed slip.
 *
 * No login: the long random token in the URL is the credential, which is why it is 16
 * random bytes rather than the rental number. It is fetched on the server and rendered as
 * plain HTML — the customer may be on a bad connection in a workshop, so this page ships
 * no JavaScript at all.
 */
export default async function PublicReceiptPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params

  let receipt: Receipt
  try {
    const res = await fetch(`${API_URL}/receipts/${encodeURIComponent(token)}/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
    if (!res.ok) notFound()
    receipt = (await res.json()) as Receipt
  } catch {
    notFound()
  }

  const { business, branch, rental, items, returns } = receipt
  const currency = business.currency
  const held = rental.deposit - rental.depositRefunded

  return (
    <main className="receipt mx-auto w-full max-w-md space-y-6 p-4 sm:my-8 sm:rounded-xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
      <header className="space-y-1 border-b pb-4 text-center">
        <h1 className="font-heading text-lg font-semibold">{business.name}</h1>
        {branch?.address && <p className="text-sm text-muted-foreground">{branch.address}</p>}
        {(branch?.phone || business.phone) && (
          <p className="text-sm text-muted-foreground">{branch?.phone || business.phone}</p>
        )}
      </header>

      <section className="space-y-1 text-sm">
        <Row label="Receipt" value={rental.code} bold />
        <Row label="Name" value={rental.customerName} />
        <Row label="Taken out" value={dateTime(rental.startedAt)} />
        {rental.dueAt && <Row label="Due back" value={dateTime(rental.dueAt)} />}
        {rental.returnedAt && <Row label="All returned" value={dateTime(rental.returnedAt)} />}
      </section>

      <section>
        <h2 className="mb-2 font-heading text-sm font-semibold">What you have</h2>
        <ul className="space-y-2 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3 border-b pb-2">
              <div className="min-w-0">
                <div>{item.productName}</div>
                <div className="text-xs text-muted-foreground">
                  {count(item.quantity)} out
                  {item.quantityReturned > 0 && ` · ${count(item.quantityReturned)} returned`}
                  {item.quantityLost > 0 && ` · ${count(item.quantityLost)} not returned`}
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                {money(item.rate, currency)}
                <div className="text-xs text-muted-foreground">per {item.plan.replace("ly", "")}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {returns.length > 0 && (
        <section>
          <h2 className="mb-2 font-heading text-sm font-semibold">Returns</h2>
          <ul className="space-y-2 text-sm">
            {returns.map((taken) => (
              <li key={taken.code} className="border-b pb-2">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{dateTime(taken.at)}</span>
                  <span className="tabular-nums">
                    {money(taken.rentTotal + taken.lateFee + taken.damageFee - taken.discount, currency)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {taken.lines.map((line) => `${count(line.quantity)} × ${line.productName}`).join(", ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1 border-t pt-4 text-sm">
        {rental.rentTotal > 0 && <Row label="Rent" value={money(rental.rentTotal, currency)} />}
        {rental.lateFee > 0 && <Row label="Late fee" value={money(rental.lateFee, currency)} />}
        {rental.damageFee > 0 && <Row label="Damage or loss" value={money(rental.damageFee, currency)} />}
        {rental.discount > 0 && <Row label="Discount" value={`− ${money(rental.discount, currency)}`} />}
        {rental.deposit > 0 && <Row label="Deposit held" value={money(held, currency)} />}
        <Row label="Paid" value={money(rental.paidAmount, currency)} />
        <Row
          label={rental.balance >= 0 ? "Still to pay" : "To be refunded to you"}
          value={money(Math.abs(rental.balance), currency)}
          bold
        />
      </section>

      {business.receiptNote && (
        <p className="border-t pt-4 text-center text-xs text-muted-foreground">{business.receiptNote}</p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Keep this link to check what you have out. Show it when you bring the items back.
      </p>
    </main>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}
