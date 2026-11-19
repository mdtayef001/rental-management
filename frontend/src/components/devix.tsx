import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The credit for the people who built and look after the software: Devix Technologies.
 *
 * It sits where a maker's mark belongs — at the foot of the login page and of every printed
 * sheet — small and quiet, so the shop's own name and logo stay the first thing anyone
 * reads on its bills and receipts. It links to Devix on screen and prints as plain text,
 * with the web address written out so it still works on paper.
 *
 * No "use client": it has no state, so server pages (login, the public receipt) can use it
 * as well as the client-side sheets.
 */
export const DEVIX_URL = "https://www.devixtechnologies.com"
const DEVIX_HOST = "www.devixtechnologies.com"

/** On a screen: login page, receipt link page. Swaps to the light logo in dark mode. */
export function DevixCredit({ className, label }: { className?: string; label?: string }) {
  return (
    <a
      href={DEVIX_URL}
      target="_blank"
      rel="noopener"
      className={cn(
        "group inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {/* A server page passes its own translation: it can't use the shared language. */}
      <span>{label ?? t("Technology partner")}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark, already sized */}
      <img src="/devix/devix-wordmark-dark.png" alt="Devix Technologies" className="h-5 w-auto opacity-80 group-hover:opacity-100 dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- the same mark for the dark theme */}
      <img src="/devix/devix-wordmark-light.png" alt="Devix Technologies" className="hidden h-5 w-auto opacity-80 group-hover:opacity-100 dark:block" />
    </a>
  )
}

/**
 * In the bottom-right corner of an A4 sheet: bill, receipt, report. A maker's mark, so it is
 * small and has no rule above it. The logo is made black and white like the rest of the sheet.
 */
export function DevixSheetCredit() {
  return (
    // On paper the page's own corner carries it (see `SheetPage`), so this is screen-only.
    <footer className="mt-4 flex items-center justify-end gap-1.5 text-[7.5pt] leading-none text-neutral-700 print:hidden">
      <span>{t("Technology partner")}</span>
      <a href={DEVIX_URL} target="_blank" rel="noopener" className="inline-flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- must print; already small */}
        <img src="/devix/devix-wordmark-dark.png" alt="Devix Technologies" className="h-[2.6mm] w-auto grayscale" />
      </a>
      <span>{DEVIX_HOST}</span>
    </footer>
  )
}

/**
 * On the till slip. Text only: a thermal head turns a small logo into a smudge, and the
 * slip is 80mm of solid black type anyway.
 */
export function DevixSlipCredit() {
  return (
    <p className="text-center text-[0.8em]">
      {t("Technology partner")}: Devix Technologies
      <br />
      {DEVIX_HOST}
    </p>
  )
}
