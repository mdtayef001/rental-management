import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS } from "@/lib/api/errors"
import { PrintButton } from "@/components/paper"
import { ReceiptDocument } from "@/components/receipt"
import { count, dateTime, money } from "@/lib/format"
import { publicLogoUrl } from "@/lib/logo"
import type { ReceiptView } from "@/lib/receipt"

export const metadata: Metadata = {
  title: "Your receipt",
  // A receipt is somebody's private record; it should never turn up in a search engine.
  robots: { index: false, follow: false },
}

interface Receipt {
  business: { name: string; phone: string; address: string; currency: string; receiptNote: string; logoVersion: string; lateFeeMultiplier?: number }
  branch: { name: string; phone: string; address: string } | null
  rental: {
    code: string
    status: string
    customerName: string
    startedAt: string
    dueAt: string | null
    returnedAt: string | null
    rentTotal: number
    lateFee: number
    damageFee: number
    discount: number
    advancePaid: number
    refunded: number
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
    refunded: number
    lines: { productName: string; quantity: number; condition: string; daysOut: number }[]
  }[]
  highlightReturn: string | null
}

/**
 * The receipt a customer opens from the link they were sent, or the QR code on their paper.
 *
 * No login: the long random token in the URL is the credential, which is why it is 16
 * random bytes rather than the rental number. It shows the same receipt the shop prints,
 * from the same component, so the paper in the customer's hand and the page on their phone
 * can never disagree.
 */
export default async function PublicReceiptPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params

  let data: Receipt
  try {
    const res = await fetch(`${API_URL}/receipts/${encodeURIComponent(token)}/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
    if (!res.ok) notFound()
    data = (await res.json()) as Receipt
  } catch {
    notFound()
  }

  const { business, branch, rental, items, returns } = data
  const currency = business.currency

  // The address this page was opened at, for the QR code: the customer's printed copy then
  // scans at the counter exactly like the shop's own.
  const head = await headers()
  const host = head.get("x-forwarded-host") ?? head.get("host")
  const link = host ? `${head.get("x-forwarded-proto") ?? "https"}://${host}/r/${token}` : null

  const receipt: ReceiptView = {
    businessName: business.name,
    branchName: branch?.name,
    address: branch?.address || business.address,
    phone: branch?.phone || business.phone,
    logo: publicLogoUrl(token, business.logoVersion),
    code: rental.code,
    startedAt: rental.startedAt,
    dueAt: rental.dueAt,
    returnedAt: rental.returnedAt,
    customerName: rental.customerName,
    items: items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      quantityReturned: item.quantityReturned,
      quantityLost: item.quantityLost,
      plan: item.plan,
      rate: item.rate,
      daysOut: item.daysOut,
      lineTotal: item.lineTotal,
    })),
    rentTotal: rental.rentTotal,
    lateFee: rental.lateFee,
    damageFee: rental.damageFee,
    discount: rental.discount,
    advancePaid: rental.advancePaid,
    refunded: rental.refunded,
    paidAmount: rental.paidAmount,
    balance: rental.balance,
    currency,
    lateFeeMultiplier: business.lateFeeMultiplier,
    note: business.receiptNote,
    link,
    state: rental.status === "cancelled" ? "cancelled" : rental.status === "returned" ? "returned" : "out",
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:py-8">
      <div className="flex justify-end print:hidden">
        <PrintButton label="Print or save as PDF" />
      </div>

      <ReceiptDocument receipt={receipt} />

      {returns.length > 0 && (
        <section className="rounded-xl border bg-card p-5 text-sm print:hidden">
          <h2 className="font-heading font-semibold">What you have brought back</h2>
          <ul className="mt-3 space-y-2">
            {returns.map((taken) => (
              <li key={taken.code} className="border-b pb-2 last:border-0 last:pb-0">
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

      <p className="text-center text-xs text-muted-foreground print:hidden">
        Keep this link to check what you have out. Show it when you bring the items back.
      </p>
    </main>
  )
}
