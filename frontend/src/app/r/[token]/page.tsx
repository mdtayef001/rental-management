import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS } from "@/lib/api/errors"
import { ReceiptDocument } from "@/components/receipt"
import { count, dateTime, money } from "@/lib/format"
import type { ReceiptView } from "@/lib/receipt"

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
 * It shows the same receipt the shop prints, from the same component, so the slip in the
 * customer's hand and the page on their phone can never disagree.
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

  const receipt: ReceiptView = {
    businessName: business.name,
    branchName: branch?.name,
    address: branch?.address || business.address,
    phone: branch?.phone || business.phone,
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
    })),
    rentTotal: rental.rentTotal,
    lateFee: rental.lateFee,
    damageFee: rental.damageFee,
    discount: rental.discount,
    deposit: rental.deposit,
    depositRefunded: rental.depositRefunded,
    paidAmount: rental.paidAmount,
    balance: rental.balance,
    currency,
    note: business.receiptNote,
    // No QR code on the customer's own copy: they are already looking at the page it
    // would open.
    link: null,
    state: rental.status === "cancelled" ? "cancelled" : rental.status === "returned" ? "returned" : "out",
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-4 p-4 sm:py-8">
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
