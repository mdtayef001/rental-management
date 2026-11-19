import { describe, expect, it } from "vitest"
import { PATTERNS, code128Bars, code128Values, encodable } from "@/lib/code128"

describe("Code 128 table", () => {
  // A wrong digit anywhere in the table makes an unreadable label, and a scanner is not
  // available in a test. Every real Code 128 character obeys these rules, so a typo
  // breaks at least one of them.
  it("has 107 characters, all different", () => {
    expect(PATTERNS).toHaveLength(107)
    expect(new Set(PATTERNS).size).toBe(107)
  })

  it("makes every character 11 modules wide, and the stop 13", () => {
    const width = (p: string) => Array.from(p).reduce((sum, w) => sum + Number(w), 0)
    expect(PATTERNS.slice(0, 106).filter((p) => width(p) !== 11)).toEqual([])
    expect(width(PATTERNS[106])).toBe(13)
  })

  it("gives every character an even number of bar modules", () => {
    const barModules = (p: string) => Array.from(p).reduce((sum, w, i) => (i % 2 === 0 ? sum + Number(w) : sum), 0)
    expect(PATTERNS.filter((p) => barModules(p) % 2 !== 0)).toEqual([])
  })

  it("uses widths of 1 to 4 modules only", () => {
    expect(PATTERNS.filter((p) => !/^[1-4]+$/.test(p))).toEqual([])
  })
})

describe("Code 128 encoding", () => {
  it("encodes text with code set B and the right checksum", () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879, and 879 mod 103 = 55.
    expect(code128Values("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106])
  })

  it("packs an even run of digits two at a time with code set C", () => {
    // 105 + 12·1 + 34·2 + 56·3 = 353, and 353 mod 103 = 44.
    expect(code128Values("123456")).toEqual([105, 12, 34, 56, 44, 106])
  })

  it("packs an odd run of digits in pairs and switches to set B for the last one", () => {
    // 105 + 88·1 + 1·2 + 23·3 + 45·4 + 67·5 + 89·6 + 100·7 + 20·8 = 2173, mod 103 = 10.
    expect(code128Values("8801234567894")).toEqual([105, 88, 1, 23, 45, 67, 89, 100, 20, 10, 106])
  })

  it("lays bars end to end, 11 modules a character plus the stop", () => {
    const { bars, width } = code128Bars("SEW-001")
    // start + 7 characters + checksum = 9 characters, then a 13-module stop.
    expect(width).toBe(9 * 11 + 13)
    expect(bars[0]).toEqual([0, 2])
    const [x, w] = bars[bars.length - 1]
    expect(x + w).toBe(width)
  })

  it("refuses text a scanner can't carry", () => {
    expect(encodable("")).toBe(false)
    expect(encodable("সেলাই")).toBe(false)
    expect(() => code128Values("সেলাই")).toThrow()
  })
})
