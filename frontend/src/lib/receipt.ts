import type { Business, Rental } from "@/lib/types"

/**
 * One rental, in the shape a receipt needs.
 *
 * The team's copy comes from the rentals API and the customer's copy from the public
 * receipt endpoint; they carry the same facts under different names. Normalising here
 * means there is one receipt layout to keep right rather than two that drift apart.
 */
export interface ReceiptView {
  businessName: string
  branchName?: string
  address?: string
  phone?: string
  code: string
  startedAt: string
  dueAt?: string | null
  returnedAt?: string | null
  customerName: string
  customerPhone?: string
  items: {
    name: string
    sku?: string
    quantity: number
    quantityReturned: number
    quantityLost: number
    plan: string
    rate: number
  }[]
  rentTotal: number
  lateFee: number
  damageFee: number
  discount: number
  deposit: number
  depositRefunded: number
  paidAmount: number
  balance: number
  currency: string
  note?: string
  /** The public link, printed as a QR code. */
  link?: string | null
  /** Out, all back, or cancelled — the one-word state at the top of the slip. */
  state: "out" | "returned" | "cancelled"
}

export function fromRental(
  rental: Rental,
  business: Business | null,
  branchName?: string,
  origin = "",
): ReceiptView {
  return {
    businessName: business?.name ?? "Rental",
    branchName,
    address: business?.address,
    phone: business?.phone,
    code: rental.code,
    startedAt: rental.startedAt,
    dueAt: rental.dueAt,
    returnedAt: rental.returnedAt,
    customerName: rental.customerName,
    customerPhone: rental.customerPhone,
    items: (rental.items ?? []).map((item) => ({
      name: item.productName,
      sku: item.productSku,
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
    currency: business?.settings.currency ?? "BDT",
    note: business?.settings.receiptNote,
    link: rental.token ? `${origin}/r/${rental.token}` : null,
    state: rental.status === "cancelled" ? "cancelled" : rental.status === "returned" ? "returned" : "out",
  }
}
