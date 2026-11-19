import type { PaymentMethod, RentalPlan } from "@/lib/types"
import { msg, t } from "@/lib/i18n"

// The price arithmetic, duplicated from backend/apps/rentals/models.py (RentalItem.quote).
//
// It has to live on both sides: staff need the price while they are filling the form, and
// the server must charge exactly that. Both are covered by tests with the same cases, so a
// change to one that doesn't match the other fails the suite rather than quietly charging
// the customer something different from what they were quoted.

/** How a customer can pay, in the order every payment form offers them. */
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: msg("Cash") },
  { value: "mobile", label: msg("Mobile banking") },
  { value: "card", label: msg("Card") },
  { value: "bank", label: msg("Bank transfer") },
]

export const PLAN_LABEL: Record<RentalPlan, string> = {
  daily: msg("Per day"),
  weekly: msg("Per week"),
  monthly: msg("Per month"),
  fixed: msg("Fixed price"),
}

const PLAN_DAYS: Record<Exclude<RentalPlan, "fixed">, number> = { daily: 1, weekly: 7, monthly: 30 }
const PLAN_UNIT: Record<Exclude<RentalPlan, "fixed">, [string, string]> = {
  daily: [msg("day"), msg("days")],
  weekly: [msg("week"), msg("weeks")],
  monthly: [msg("month"), msg("months")],
}

export interface RentalQuote {
  periods: number
  periodLabel: string
  subtotal: number
  total: number
  /** A plain-language sum, shown under the figure so staff can check it. */
  breakdown: string
}

/**
 * What `quantity` units cost for `days` days on `plan`.
 *
 * Per day: the days, less holidays. Weekly and monthly bill every *started* period, so 10
 * days on a weekly plan is 2 weeks and holidays don't apply. Fixed is one price however
 * long it was out.
 */
export function quoteRental(plan: RentalPlan, rate: number, days: number, quantity: number, holidays = 0): RentalQuote {
  const safeDays = Math.max(1, Math.floor(days || 1))
  const qty = Math.max(1, Math.floor(quantity || 1))
  const safeRate = Math.max(0, rate || 0)

  if (plan === "fixed") {
    return {
      periods: 1,
      periodLabel: `${safeDays} ${t(safeDays === 1 ? "day" : "days")}`,
      subtotal: safeRate,
      total: safeRate * qty,
      breakdown: qty > 1 ? `${qty} × ${t("fixed price")}` : t("Fixed price"),
    }
  }

  const off = plan === "daily" ? Math.min(Math.max(0, Math.floor(holidays || 0)), safeDays) : 0
  const periods = plan === "daily" ? safeDays - off : Math.ceil(safeDays / PLAN_DAYS[plan])
  const [one, many] = PLAN_UNIT[plan]
  const periodLabel = `${periods} ${t(periods === 1 ? one : many)}`
  const subtotal = periods * safeRate
  return {
    periods,
    periodLabel,
    subtotal,
    total: subtotal * qty,
    breakdown: `${periodLabel} × ${t("rate")}${qty > 1 ? ` × ${t("{count} units", { count: qty })}` : ""}${off ? ` (${t("{count} free", { count: off })})` : ""}`,
  }
}

/**
 * Days out, counting any started day.
 *
 * Out at 10:00 and back by 10:00 the next day is 1 day; back at 11:00 is 2, because the
 * customer had it for part of a second day. Never less than 1. Same rule as Django's
 * `RentalItem.count_days`.
 */
export function countDays(start: string | Date, end: string | Date = new Date()) {
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  return Math.max(1, Math.ceil((to - from) / 86_400_000))
}

/** Days late, counting any started day — the same rule, so the late fee matches the rent. */
export function daysLate(dueAt: string | null, at: string | Date = new Date()) {
  if (!dueAt) return 0
  const due = new Date(dueAt).getTime()
  const now = new Date(at).getTime()
  return now <= due ? 0 : countDays(dueAt, at)
}

/**
 * What one day of a plan is worth, for the late fee. A fixed price has no daily value, so
 * its own rate stands in for one. Mirrors `RentalItem.daily_value` on the server.
 */
export function dailyValue(plan: RentalPlan, rate: number) {
  return plan === "weekly" || plan === "monthly" ? rate / PLAN_DAYS[plan] : rate
}

/** The product's rate for a plan, or null when it has none set. */
export function rateFor(
  product: { rentDaily: number | null; rentWeekly: number | null; rentMonthly: number | null },
  plan: RentalPlan,
) {
  if (plan === "daily") return product.rentDaily
  if (plan === "weekly") return product.rentWeekly
  if (plan === "monthly") return product.rentMonthly
  return null
}

/** The plans a product actually has a price for, so the form can't offer an unpriced one. */
export function availablePlans(product: {
  rentDaily: number | null
  rentWeekly: number | null
  rentMonthly: number | null
}): RentalPlan[] {
  const plans: RentalPlan[] = []
  if (product.rentDaily) plans.push("daily")
  if (product.rentWeekly) plans.push("weekly")
  if (product.rentMonthly) plans.push("monthly")
  // Always available: staff can agree a one-off price for anything.
  plans.push("fixed")
  return plans
}
