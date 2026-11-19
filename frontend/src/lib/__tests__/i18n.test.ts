import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { bn, fromServer } from "@/lib/i18n/bn"
import { translate } from "@/lib/i18n"

/**
 * Every phrase the app can show has a Bangla entry.
 *
 * The phrases are found the same way a person would find them: by reading the source for
 * `t("…")`, `msg("…")`, `pageTitle("…")` and the nouns handed to `plural()`. A phrase built
 * from a variable — `t(item.label)` — is covered by the `msg("…")` where that label is
 * defined.
 */
const SRC = path.resolve(__dirname, "../..")

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full)
    return /\.(ts|tsx)$/.test(name) && !full.endsWith(path.join("i18n", "bn.ts")) ? [full] : []
  })
}

const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`

export function phrases() {
  const found = new Map<string, string>()
  for (const file of files(SRC)) {
    // Comments talk about `t("…")` without being phrases, so they are left out.
    const text = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n")
    const where = path.relative(SRC, file)
    for (const match of text.matchAll(new RegExp(String.raw`\b(?:t|msg|pageTitle)\(\s*` + LITERAL, "g"))) {
      found.set(JSON.parse(`"${match[1]}"`), where)
    }
    // t(one === 1 ? "… has …" : "… have …")
    for (const match of text.matchAll(new RegExp(String.raw`\bt\(\s*[^"()]+\?\s*` + LITERAL + String.raw`\s*:\s*` + LITERAL, "g"))) {
      found.set(JSON.parse(`"${match[1]}"`), where)
      found.set(JSON.parse(`"${match[2]}"`), where)
    }
    // plural(n, "day") shows "day" or "days"; plural(n, "person", "people") names both.
    for (const match of text.matchAll(new RegExp(String.raw`\bplural\([^,()]+(?:\([^()]*\))?[^,()]*,\s*` + LITERAL + String.raw`(?:,\s*` + LITERAL + ")?", "g"))) {
      const one = JSON.parse(`"${match[1]}"`)
      found.set(one, where)
      found.set(match[2] ? JSON.parse(`"${match[2]}"`) : one + "s", where)
    }
  }
  return found
}

describe("Bangla", () => {
  const used = phrases()

  it("has every phrase the app shows", () => {
    const missing = [...used].filter(([phrase]) => !(phrase in bn)).map(([phrase, file]) => `${file}: ${phrase}`)
    expect(missing).toEqual([])
  })

  it("has nothing the app no longer shows", () => {
    const unused = Object.keys(bn).filter((phrase) => !used.has(phrase) && !(phrase in fromServer))
    expect(unused).toEqual([])
  })

  it("keeps every placeholder", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const broken = Object.entries(bn).filter(([en, text]) => names(en).join() !== names(text).join())
    expect(broken.map(([en]) => en)).toEqual([])
  })

  it("fills placeholders and falls back to English", () => {
    expect(translate("bn", "Due in {days}", { days: "3 দিন" })).toBe(bn["Due in {days}"].replace("{days}", "3 দিন"))
    expect(translate("bn", "A phrase nobody wrote")).toBe("A phrase nobody wrote")
    expect(translate("en", "Take back")).toBe("Take back")
  })
})
