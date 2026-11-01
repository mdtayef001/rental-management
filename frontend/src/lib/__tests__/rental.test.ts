import { describe, expect, it } from "vitest"
import { countDays, daysLate, quoteRental } from "@/lib/rental"

/**
 * The same cases as `QuoteTests` in backend/apps/rentals/tests.py.
 *
 * The price arithmetic exists on both sides — staff need it live in the form, the server
 * charges it — so these tests are deliberately a mirror image. If someone changes one
 * formula and not the other, one of the two suites fails instead of a customer quietly
 * being charged something different from the quote they were given.
 */
describe("quoteRental", () => {
  const total = (...args: Parameters<typeof quoteRental>) => quoteRental(...args).total

  it("charges per day, less holidays", () => {
    expect(total("daily", 50, 3, 1)).toBe(150)
    expect(total("daily", 50, 3, 100)).toBe(15_000)
    expect(total("daily", 50, 10, 1, 3)).toBe(350)
    // More holidays than days costs nothing, never a negative amount.
    expect(total("daily", 50, 2, 1, 5)).toBe(0)
  })

  it("charges every started week", () => {
    expect(total("weekly", 300, 7, 1)).toBe(300)
    expect(total("weekly", 300, 8, 1)).toBe(600)
    expect(total("weekly", 300, 14, 1)).toBe(600)
    // Holidays don't apply to weekly pricing.
    expect(total("weekly", 300, 8, 1, 5)).toBe(600)
  })

  it("charges every started month", () => {
    expect(total("monthly", 1000, 30, 1)).toBe(1000)
    expect(total("monthly", 1000, 31, 1)).toBe(2000)
  })

  it("charges a fixed price however long it was out", () => {
    expect(total("fixed", 5000, 1, 1)).toBe(5000)
    expect(total("fixed", 5000, 90, 1)).toBe(5000)
    expect(total("fixed", 5000, 90, 3)).toBe(15_000)
  })

  it("explains the sum so staff can check it", () => {
    expect(quoteRental("daily", 50, 3, 100).breakdown).toBe("3 days × rate × 100 units")
    expect(quoteRental("weekly", 300, 8, 1).breakdown).toBe("2 weeks × rate")
    expect(quoteRental("daily", 50, 10, 1, 3).breakdown).toBe("7 days × rate (3 free)")
  })

  it("treats nonsense input as the cheapest sane value rather than crashing", () => {
    expect(total("daily", 50, 0, 0)).toBe(50)
    expect(total("daily", -5, 3, 1)).toBe(0)
  })
})

describe("countDays", () => {
  const start = new Date("2026-11-01T10:00:00Z")

  it("counts any started day", () => {
    expect(countDays(start, start)).toBe(1)
    expect(countDays(start, new Date("2026-11-02T09:00:00Z"))).toBe(1)
    expect(countDays(start, new Date("2026-11-02T10:00:00Z"))).toBe(1)
    // An hour into a second day is a second day.
    expect(countDays(start, new Date("2026-11-02T11:00:00Z"))).toBe(2)
    expect(countDays(start, new Date("2026-11-04T10:00:00Z"))).toBe(3)
    expect(countDays(start, new Date("2026-11-04T10:00:01Z"))).toBe(4)
  })

  it("never returns less than a day, even for a return dated before the start", () => {
    expect(countDays(start, new Date("2026-10-01T10:00:00Z"))).toBe(1)
  })
})

describe("daysLate", () => {
  const due = "2026-11-01T10:00:00Z"

  it("is zero until the due date passes", () => {
    expect(daysLate(due, new Date("2026-11-01T09:00:00Z"))).toBe(0)
    expect(daysLate(due, new Date("2026-11-01T10:00:00Z"))).toBe(0)
  })

  it("counts started late days, the same rule as the rent", () => {
    expect(daysLate(due, new Date("2026-11-02T10:00:00Z"))).toBe(1)
    expect(daysLate(due, new Date("2026-11-06T14:00:00Z"))).toBe(6)
  })

  it("is zero for an open-ended rental", () => {
    expect(daysLate(null, new Date("2030-01-01T00:00:00Z"))).toBe(0)
  })
})
