import { round2 } from "@/lib/format"
import { logoUrl } from "@/lib/logo"
import { countDays, daysLate, quoteRental } from "@/lib/rental"
import type { Business, Rental, RentalPlan } from "@/lib/types"

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
  /** The business's logo, when it has uploaded one. */
  logo?: string | null
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
    /** Days billed and what the line has been charged, once any of it is back. */
    daysOut?: number | null
    lineTotal: number
  }[]
  rentTotal: number
  lateFee: number
  damageFee: number
  discount: number
  /** Paid when the items went out, before any rent was charged. */
  advancePaid: number
  /** Unused money handed back to the customer. */
  refunded: number
  /** Everything paid, less anything given back. */
  paidAmount: number
  balance: number
  currency: string
  /** The shop's late-fee multiple of a day's rent, for showing what being overdue is costing. */
  lateFeeMultiplier?: number
  note?: string
  /** The public link, printed as a QR code. */
  link?: string | null
  /** Out, all back, or cancelled — the one-word state at the top of the receipt. */
  state: "out" | "returned" | "cancelled"
}

export const RECEIPT_STATE: Record<ReceiptView["state"], string> = {
  out: "Out on rent",
  returned: "All returned",
  cancelled: "Cancelled",
}

/** The money lines of a receipt, worked out once so the sheet and the till slip agree. */
export function receiptSums(r: ReceiptView) {
  const charges = r.rentTotal + r.lateFee + r.damageFee - r.discount
  return {
    charges,
    /** Paid after the items went out: at a return, or against a bill. */
    paidLater: r.paidAmount - r.advancePaid + r.refunded,
    /**
     * What the last line says. While items are still out, money paid ahead is credit that
     * the rent will be charged against; once everything is back it is simply owed back.
     */
    closing:
      r.balance > 0
        ? "Balance due"
        : r.balance < 0
          ? r.state === "out"
            ? "In credit"
            : "To give back"
          : "Balance due",
  }
}

/**
 * What the items still out have run up, which nothing has charged yet.
 *
 * Rent is only charged when items come back, so a receipt for a rental that is still out
 * used to read "Rent 0.00", which looks like a mistake to the customer holding it. This
 * works the running figure out the same way a return will:
 *
 *  - with a return date still ahead, the hire is the agreed one, from the day taken to the
 *    day due back;
 *  - past that date, or with no date agreed, it runs to today, and each day past the date
 *    adds the shop's late fee on top.
 *
 * It is an estimate until the return is taken: the days can still change.
 */
export function receiptEstimate(r: ReceiptView, now = new Date()) {
  const open = r.state === "out"
  const due = r.dueAt ? new Date(r.dueAt) : null
  const toDue = !!due && due.getTime() > now.getTime()
  const days = countDays(r.startedAt, toDue ? due! : now)
  const overdueDays = open ? daysLate(r.dueAt ?? null, now) : 0
  const multiplier = r.lateFeeMultiplier ?? 1

  const lines = r.items.map((item) => {
    const out = open ? Math.max(0, item.quantity - item.quantityReturned - item.quantityLost) : 0
    if (!out) return { out: 0, rent: 0, lateFee: 0 }
    const plan = item.plan as RentalPlan
    const daily = plan === "weekly" ? item.rate / 7 : plan === "monthly" ? item.rate / 30 : item.rate
    return {
      out,
      rent: round2(quoteRental(plan, item.rate, days, out).total),
      lateFee: round2(daily * multiplier * overdueDays * out),
    }
  })
  const rent = round2(lines.reduce((sum, line) => sum + line.rent, 0))
  const lateFee = round2(lines.reduce((sum, line) => sum + line.lateFee, 0))
  return {
    /** Per item, in the order of `r.items`. */
    lines,
    /** Whether anything is still out, and so whether there is anything to estimate. */
    running: lines.some((line) => line.out > 0),
    days,
    /** True while the figure is for the agreed hire, up to a return date still ahead. */
    toDue,
    overdueDays,
    rent,
    lateFee,
    /** The balance once the running rent and late fee are counted. */
    balance: round2(r.balance + rent + lateFee),
  }
}

/** How many days after its return date a rental came back, or 0 when on time or undated. */
export function returnedLateDays(r: ReceiptView) {
  return r.returnedAt ? daysLate(r.dueAt ?? null, r.returnedAt) : 0
}

export function fromRental(
  rental: Rental,
  business: Business | null,
  branchName?: string,
  origin = "",
): ReceiptView {
  const payments = rental.payments ?? []
  return {
    businessName: business?.name ?? "Rental",
    branchName,
    address: business?.address,
    phone: business?.phone,
    logo: logoUrl(business?.logoVersion),
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
      daysOut: item.daysOut,
      lineTotal: item.lineTotal,
    })),
    rentTotal: rental.rentTotal,
    lateFee: rental.lateFee,
    damageFee: rental.damageFee,
    discount: rental.discount,
    advancePaid: payments.filter((p) => p.kind === "advance").reduce((sum, p) => sum + p.amount, 0),
    refunded: -payments.filter((p) => p.kind === "refund").reduce((sum, p) => sum + p.amount, 0),
    paidAmount: rental.paidAmount,
    balance: rental.balance,
    currency: business?.settings.currency ?? "BDT",
    lateFeeMultiplier: business?.settings.rentals?.lateFeeMultiplier,
    note: business?.settings.receiptNote,
    link: rental.token ? `${origin}/r/${rental.token}` : null,
    state: rental.status === "cancelled" ? "cancelled" : rental.status === "returned" ? "returned" : "out",
  }
}
