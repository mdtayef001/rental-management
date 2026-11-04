import { describe, it, expect } from "vitest"
import { compactMoney } from "@/lib/format"

describe("compactMoney", () => {
  it("states small amounts exactly", () => {
    expect(compactMoney(0)).toBe("৳0.00")
    expect(compactMoney(999.5)).toBe("৳999.50")
  })
  it("scales thousands, lakh and crore", () => {
    expect(compactMoney(1000)).toBe("৳1k")
    expect(compactMoney(43554.29)).toBe("৳43.6k")
    expect(compactMoney(99999)).toBe("৳100k")
    expect(compactMoney(100000)).toBe("৳1 lakh")
    expect(compactMoney(125000)).toBe("৳1.25 lakh")
    expect(compactMoney(9500000)).toBe("৳95 lakh")
    expect(compactMoney(10000000)).toBe("৳1 crore")
    expect(compactMoney(34500000)).toBe("৳3.45 crore")
  })
  it("keeps the sign and the currency", () => {
    expect(compactMoney(-250000)).toBe("−৳2.5 lakh")
    expect(compactMoney(43554, "USD")).toBe("$43.6k")
  })
})
