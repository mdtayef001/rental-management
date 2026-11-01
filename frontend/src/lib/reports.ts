import { format, startOfMonth, startOfYear, subDays, subMonths } from "date-fns"
import type { ReportRange } from "@/lib/types"

/**
 * The date ranges a report can cover.
 *
 * Dates are plain `YYYY-MM-DD` strings in the shop's own local time all the way to Django,
 * which reads them as whole local days. No timezone arithmetic happens in the browser, so
 * a report "for October" means the same thing on the owner's phone as on the counter PC.
 */

export const iso = (day: Date) => format(day, "yyyy-MM-dd")

export interface Preset {
  id: string
  label: string
  range: () => ReportRange
}

/** Written the way a shop owner asks for them, commonest first. */
export const PRESETS: Preset[] = [
  {
    id: "month",
    label: "This month",
    range: () => ({ from: iso(startOfMonth(new Date())), to: iso(new Date()) }),
  },
  {
    id: "last-month",
    label: "Last month",
    range: () => {
      const start = startOfMonth(subMonths(new Date(), 1))
      return { from: iso(start), to: iso(subDays(startOfMonth(new Date()), 1)) }
    },
  },
  {
    id: "7d",
    label: "Last 7 days",
    range: () => ({ from: iso(subDays(new Date(), 6)), to: iso(new Date()) }),
  },
  {
    id: "90d",
    label: "Last 90 days",
    range: () => ({ from: iso(subDays(new Date(), 89)), to: iso(new Date()) }),
  },
  {
    id: "year",
    label: "This year",
    range: () => ({ from: iso(startOfYear(new Date())), to: iso(new Date()) }),
  },
]

export const DEFAULT_PRESET = PRESETS[0]

/** Which preset a range matches, or "" when the dates were typed by hand. */
export function presetFor(range: ReportRange) {
  return PRESETS.find((p) => {
    const preset = p.range()
    return preset.from === range.from && preset.to === range.to
  })?.id ?? ""
}

/** "1–31 October" / "1 Oct 2026 – 3 Nov 2026": short when it can be, explicit when it must be. */
export function rangeLabel({ from, to }: ReportRange) {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (from === to) return format(start, "d MMMM yyyy")
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`
  }
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, "d")}–${format(end, "d MMMM yyyy")}`
  }
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
}

/** The axis label for one bucket of a revenue series. */
export function periodLabel(period: string, group: "day" | "week" | "month") {
  const day = new Date(`${period}T00:00:00`)
  if (group === "month") return format(day, "MMM yyyy")
  if (group === "week") return format(day, "d MMM")
  return format(day, "d MMM")
}
