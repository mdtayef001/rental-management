import { bn } from "./bn"

/**
 * English and Bangla.
 *
 * The English text in the code IS the key: `t("Take back")` shows "Take back" in English
 * and looks the phrase up in `bn.ts` in Bangla. Nothing has to be named twice, a phrase
 * with no translation yet falls back to English instead of showing a key, and a test
 * (`__tests__/i18n.test.ts`) fails if any `t("…")` in the source has no Bangla entry.
 *
 * Placeholders are `{name}`: `t("Due in {days}", { days: "3 days" })`.
 *
 * Digits stay Western in both languages. Rental numbers, SKUs and barcodes are compared
 * character by character against printed labels, and money is easier to check when every
 * figure on the screen uses the same digits.
 */
export type Lang = "en" | "bn"

export const LANGS: Lang[] = ["en", "bn"]
export const LANG_COOKIE = "lang"

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "bn"
}

/**
 * The language the page is being drawn in.
 *
 * Held here rather than only in React context so that plain helpers — `plural`, `date`,
 * `dueLabel`, a toast's message — translate too, without every caller passing it along.
 * `I18nProvider` sets it from the `lang` cookie the server read, before anything under it
 * renders, so the server's HTML and the browser's first render agree.
 */
let current: Lang = "en"

export function setLang(lang: Lang) {
  current = lang
}

export function getLang(): Lang {
  return current
}

type Vars = Record<string, string | number>

export function translate(lang: Lang, text: string, vars?: Vars): string {
  const found = lang === "bn" ? bn[text] : undefined
  const out = found ?? text
  return vars ? out.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : out
}

/** Translate a phrase into the current language. */
export function t(text: string, vars?: Vars): string {
  return translate(current, text, vars)
}

/**
 * Marks a phrase kept in a constant — a menu label, a status name — as one to translate.
 * It returns the English unchanged: the constant is built once, at import, before anyone
 * has chosen a language, so the translating happens where it is shown, with `t(label)`.
 * The marker is what lets the coverage test find these phrases.
 */
export function msg<T extends string>(text: T): T {
  return text
}
