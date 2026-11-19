"use client"

import { Fragment, createContext, useContext, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LANG_COOKIE, setLang, t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const LangContext = createContext<Lang>("en")

/**
 * Puts the reader's language in place for everything under it.
 *
 * `setLang` runs during render, before any child renders, so the module-level language the
 * `t()` helper reads is already right for this tree.
 *
 * Components call plain `t()` rather than subscribing to anything, so on a switch nothing
 * below would know to redraw. Keying the tree on the language remounts it instead: every
 * screen draws again in the new language. The query cache lives above this, so no data is
 * fetched again.
 */
export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  setLang(lang)
  return (
    <LangContext.Provider value={lang}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}

/**
 * English ⇄ বাংলা.
 *
 * The choice is kept in a cookie for a year, so the server draws the next page in it too,
 * and `router.refresh()` redraws this one in place, without a full page load.
 */
export function LanguageToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const lang = useLang()
  const router = useRouter()
  const [pending, start] = useTransition()
  const next: Lang = lang === "bn" ? "en" : "bn"

  function toggle() {
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = next
    start(() => router.refresh())
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={pending}
      className={cn("gap-1.5", className)}
      aria-label={t("Switch language")}
      title={t("Switch language")}
    >
      <Languages className="size-4" />
      {/* Each language is named in itself, so someone who can't read the current one can
          still find their own. */}
      {compact ? (next === "bn" ? "বাং" : "EN") : next === "bn" ? "বাংলা" : "English"}
    </Button>
  )
}
