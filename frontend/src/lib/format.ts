import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns"

/**
 * Money, with the business's currency.
 *
 * Amounts arrive as JSON numbers (COERCE_DECIMAL_TO_STRING is off in Django), so they are
 * formatted, never used for arithmetic the server hasn't already done.
 */
export function money(amount: number | string | null | undefined, currency = "BDT") {
  const value = Number(amount ?? 0)
  const symbol = CURRENCY_SYMBOL[currency] ?? currency + " "
  const text = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${value < 0 ? "−" : ""}${symbol}${text}`
}

const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$", EUR: "€", GBP: "£", INR: "₹" }

/**
 * A big amount at a glance: ৳43.6k, ৳1.25 lakh, ৳3.4 crore.
 *
 * Scaled the way the shop counts — thousands, then lakh, then crore — because a figure
 * someone reads in passing only has to carry the order of magnitude. Anything under a
 * thousand is already short enough to state exactly. The precise amount is never lost:
 * it is one hover away here, and Reports has every row of it.
 */
export function compactMoney(amount: number | string | null | undefined, currency = "BDT") {
  const value = Number(amount ?? 0)
  const symbol = CURRENCY_SYMBOL[currency] ?? currency + " "
  const abs = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (abs < 1_000) return money(value, currency)

  const [scaled, unit] =
    abs >= 10_000_000 ? [abs / 10_000_000, " crore"] : abs >= 100_000 ? [abs / 100_000, " lakh"] : [abs / 1_000, "k"]

  // Two decimals while the number is small enough for them to mean something, one after.
  const rounded = scaled < 10 ? Math.round(scaled * 100) / 100 : Math.round(scaled * 10) / 10
  return `${sign}${symbol}${rounded.toLocaleString()}${unit}`
}

/** A whole number with thousands separators. Counts are never shown with a fraction. */
export function count(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)).toLocaleString()
}

/** An amount rounded to the two decimal places money is kept in. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function date(value: string | Date | null | undefined) {
  if (!value) return "—"
  return format(new Date(value), "d MMM yyyy")
}

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return "—"
  return format(new Date(value), "d MMM yyyy, h:mm a")
}

/** "Today, 3:40 pm" / "Yesterday, 9:05 am" / "12 Oct 2026" — for activity and ledgers. */
export function friendlyDateTime(value: string | Date | null | undefined) {
  if (!value) return "—"
  const d = new Date(value)
  if (isToday(d)) return `Today, ${format(d, "h:mm a")}`
  if (isYesterday(d)) return `Yesterday, ${format(d, "h:mm a")}`
  return format(d, "d MMM yyyy, h:mm a")
}

export function ago(value: string | Date | null | undefined) {
  if (!value) return "—"
  return `${formatDistanceToNowStrict(new Date(value))} ago`
}

export function plural(n: number, one: string, many = one + "s") {
  return `${count(n)} ${n === 1 ? one : many}`
}

/** "3 days overdue" / "due in 2 days" / "due today" / "" when open-ended. */
export function dueLabel(dueAt: string | null, now = new Date()) {
  if (!dueAt) return "No return date"
  const due = new Date(dueAt)
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000)
  if (days < 0) return `${plural(-days, "day")} overdue`
  if (days === 0) return "Due today"
  return `Due in ${plural(days, "day")}`
}

/** A phone number as a WhatsApp link, for sending a customer their receipt. */
export function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "")
  if (!digits) return null
  // Bangladeshi numbers are usually stored as 01XXXXXXXXX; WhatsApp needs the country code.
  const international = digits.startsWith("0") ? `88${digits.slice(1)}` : digits
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`
}
