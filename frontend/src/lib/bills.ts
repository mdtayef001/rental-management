import { addMonths, addYears, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from "date-fns"
import { iso } from "@/lib/reports"
import type { BillKind, ReportRange } from "@/lib/types"

/**
 * The period a bill covers.
 *
 * A bill is for a whole month or a whole year far more often than for anything else, so
 * those are one tap each and step backwards and forwards with the arrows. Dates stay plain
 * `YYYY-MM-DD` strings in the shop's local time, exactly as on Reports.
 */

const parse = (day: string) => new Date(`${day}T00:00:00`)

export function monthOf(day: Date): ReportRange {
  return { from: iso(startOfMonth(day)), to: iso(endOfMonth(day)) }
}

export function yearOf(day: Date): ReportRange {
  return { from: iso(startOfYear(day)), to: iso(endOfYear(day)) }
}

/** Whether a range is exactly one calendar month, one calendar year, or neither. */
export function kindOf(range: ReportRange): BillKind {
  const start = parse(range.from)
  if (range.from === iso(startOfMonth(start)) && range.to === iso(endOfMonth(start))) return "month"
  if (range.from === iso(startOfYear(start)) && range.to === iso(endOfYear(start))) return "year"
  return "custom"
}

/** The month or year before (-1) or after (+1) this one. A custom range doesn't step. */
export function step(range: ReportRange, by: 1 | -1): ReportRange {
  const kind = kindOf(range)
  const start = parse(range.from)
  if (kind === "month") return monthOf(addMonths(start, by))
  if (kind === "year") return yearOf(addYears(start, by))
  return range
}

/** "November 2026" / "2026" / "1 Nov 2026 – 15 Nov 2026". */
export function periodName(range: ReportRange) {
  const kind = kindOf(range)
  const start = parse(range.from)
  if (kind === "month") return format(start, "MMMM yyyy")
  if (kind === "year") return format(start, "yyyy")
  return `${format(start, "d MMM yyyy")} – ${format(parse(range.to), "d MMM yyyy")}`
}

export const BILL_TITLE: Record<BillKind, string> = { month: "Monthly bill", year: "Yearly bill", custom: "Bill" }

/** A range from `?from=&to=`, falling back to this month when the link carries none. */
export function rangeFromParams(params: { get(name: string): string | null }): ReportRange {
  const valid = (text: string | null) => (text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null)
  const from = valid(params.get("from"))
  const to = valid(params.get("to"))
  if (!from || !to || from > to) return monthOf(new Date())
  return { from, to }
}

export function rangeQuery(range: ReportRange) {
  return `from=${range.from}&to=${range.to}`
}
