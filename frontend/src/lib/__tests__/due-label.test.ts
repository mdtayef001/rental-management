import { describe, expect, it } from "vitest"
import { dueLabel } from "@/lib/format"

describe("dueLabel", () => {
  const due = "2026-11-10T10:00:00Z"

  it("counts any started day overdue, as the server's late fee does", () => {
    expect(dueLabel(due, new Date("2026-11-11T22:00:00Z"))).toBe("2 days overdue")
    expect(dueLabel(due, new Date("2026-11-10T11:00:00Z"))).toBe("1 day overdue")
  })

  it("counts down to a date still ahead", () => {
    expect(dueLabel(due, new Date("2026-11-07T10:00:00Z"))).toBe("Due in 3 days")
    expect(dueLabel(null)).toBe("No return date")
  })
})
