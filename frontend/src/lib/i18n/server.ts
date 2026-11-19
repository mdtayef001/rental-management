import "server-only"
import { cookies } from "next/headers"
import { LANG_COOKIE, isLang, translate, type Lang } from "@/lib/i18n"

/** The language this request asked for, from the toggle's cookie. English when unset. */
export async function getRequestLang(): Promise<Lang> {
  const value = (await cookies()).get(LANG_COOKIE)?.value
  return isLang(value) ? value : "en"
}

/**
 * `t` for server components and metadata.
 *
 * These render per request, possibly at the same moment as someone else's page in the
 * other language, so they never touch the shared current language: the language travels
 * with the call.
 */
export async function getT() {
  const lang = await getRequestLang()
  return (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars)
}

/** A page's `<title>`, in the reader's language. */
export async function pageTitle(title: string) {
  const t = await getT()
  return { title: t(title) }
}
