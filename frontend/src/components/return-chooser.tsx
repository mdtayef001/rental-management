"use client"

import { AlertTriangle, ArrowRight, Clock, Package, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { count, dateTime, money, plural } from "@/lib/format"
import type { ReturnMatch } from "@/lib/types"
import { t } from "@/lib/i18n"

/**
 * "Which of these is the customer bringing back?"
 *
 * The screen that answers the client's requirement directly. Scanning a product barcode can
 * match several open rentals — the same customer renting the same thing twice, or two
 * customers with the same item — and the system must never guess which one is being
 * returned, because guessing wrong closes the wrong rental and charges the wrong person.
 *
 * Every row therefore carries the four things that tell two rentals apart at a glance:
 * who has it, which rental, how many are still out, and how long they've had it. Overdue
 * rows are flagged, and the running charge is shown so staff can answer "how much?"
 * before they commit to anything.
 */
export function ReturnChooser({
  matches,
  onPick,
  heading,
  currency = "BDT",
}: {
  matches: ReturnMatch[]
  onPick: (match: ReturnMatch) => void
  heading?: string
  currency?: string
}) {
  if (matches.length === 0) return null

  // Oldest first: the thing that's been out longest is usually what's coming back, and it's
  // the one most likely to be overdue.
  const rows = [...matches].sort((a, b) => b.daysOut - a.daysOut)
  // A product scan lists one product across rentals; a receipt or a customer lists several
  // products, and then the product is what tells the rows apart, so it leads.
  const sameProduct = new Set(matches.map((m) => m.productId ?? m.productName)).size === 1

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{heading ?? t("Which one is coming back?")}</h2>
        <p className="text-sm text-muted-foreground">
          {sameProduct
            ? t(matches.length === 1 ? "{rentals} has this item still out." : "{rentals} have this item still out.", {
                rentals: plural(matches.length, "rental"),
              })
            : t("{items} still out.", { items: plural(matches.length, "item") })}{" "}
          {t("Pick the one in front of you.")}
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((match) => (
          <li key={match.itemId}>
            <button
              type="button"
              onClick={() => onPick(match)}
              className={cn(
                "group flex w-full items-center gap-4 rounded-lg border p-4 text-left transition",
                "hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                match.isOverdue && "border-destructive/40 bg-destructive/5",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="truncate font-heading text-base font-semibold">{match.productName}</div>
                {/* Who has it — the first thing staff check against the person at the counter. */}
                <div className="flex flex-wrap items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{match.customerName}</span>
                  {match.customerPhone && (
                    <span className="truncate text-sm text-muted-foreground">{match.customerPhone}</span>
                  )}
                  <Badge variant="outline" className="font-mono text-xs">
                    {match.rentalCode}
                  </Badge>
                  {match.isOverdue && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {t("{days} overdue", { days: plural(match.overdueDays, "day") })}
                    </Badge>
                  )}
                </div>

                {/* What and how many — the number staff type into the return. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Package className="size-3.5" />
                    {t("{out} of {total} still out", { out: count(match.quantityOut), total: count(match.quantity) })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {t("{days} out", { days: plural(match.daysOut, "day") })}
                  </span>
                  {match.quantityReturned > 0 && <span>{t("{count} already back", { count: count(match.quantityReturned) })}</span>}
                </div>

                <div className="text-xs text-muted-foreground">
                  {t("Out {date}", { date: dateTime(match.startedAt) })}
                </div>
              </div>

              {/* What it costs if all of it comes back now, so "how much?" needs no extra tap. */}
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{money(match.quoteNow, currency)}</div>
                <div className="text-xs text-muted-foreground">{t("if all back now")}</div>
              </div>

              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Shown when a scan matched a product but nothing is out on rent for it. */
export function NothingOut({ productName, onReset }: { productName?: string; onReset: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <Package className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">{t("Nothing out on rent")}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {productName ? (
          <>
            {t("{product} isn't out with anyone right now, so there's nothing to take back.", { product: productName })}
          </>
        ) : (
          <>{t("That item isn't out with anyone right now.")}</>
        )}
      </p>
      <Button variant="outline" className="mt-4" onClick={onReset}>
        {t("Scan something else")}
      </Button>
    </div>
  )
}

/** Shown when the code matched no product and no rental at all. */
export function NotRecognised({ code, onReset, onSearch }: { code: string; onReset: () => void; onSearch?: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">{t("That code isn't recognised")}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {t("Nothing matches {code}. It may belong to another shop, or the label may be damaged.", { code })}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" onClick={onReset}>
          {t("Try again")}
        </Button>
        {onSearch && <Button onClick={onSearch}>{t("Search by name instead")}</Button>}
      </div>
    </div>
  )
}
