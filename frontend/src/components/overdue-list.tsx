"use client"

import Link from "next/link"
import { MessageCircle, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/common"
import { useCurrency, useSession } from "@/components/session"
import { useRentals } from "@/lib/data/queries"
import { count, money, plural, whatsappLink } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Rental } from "@/lib/types"

/**
 * The chase list.
 *
 * An overdue rental is not a statistic — it is a phone call somebody has to make. So this
 * is built as a work queue rather than another panel of figures: worst first, with the
 * person's number right there, and the money at stake stated plainly.
 *
 * The day block carries the urgency. A date like "due 26 Oct" makes the reader do
 * arithmetic; a solid block reading "6 days" that darkens as it gets worse can be read
 * across the room, and it lets someone rank five rows at a glance without comparing dates.
 *
 * This is the one loud element on the dashboard. Everything around it stays quiet.
 */
export function OverdueList({ limit = 5 }: { limit?: number }) {
  const currency = useCurrency()
  const { data, isLoading } = useRentals({ page: 1, status: "overdue", sort: "due" }, { pageSize: limit })

  const rentals = data?.results ?? []
  const total = data?.count ?? 0

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Checking what&apos;s late…
        </CardContent>
      </Card>
    )
  }

  // Nothing late is good news, and good news gets a quiet card rather than a loud one.
  if (total === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Nothing overdue</CardTitle>
          <CardDescription>Everything that is out is still within its date.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    // The one card on the dashboard with a coloured edge: it is the only thing here that
    // asks somebody to pick up the phone.
    <Card className="h-full border-l-2 border-l-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">{plural(total, "rental")} overdue</CardTitle>
        <CardDescription>Worst first. Ring them, or send a WhatsApp.</CardDescription>
        {total > rentals.length && (
          <CardAction>
            <Button variant="ghost" size="sm" render={<Link href="/rentals?status=overdue" />}>
              See all {count(total)}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="space-y-px">
          {rentals.map((rental) => (
            <OverdueRow key={rental.id} rental={rental} currency={currency} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function OverdueRow({ rental, currency }: { rental: Rental; currency: string }) {
  const { business } = useSession()
  const days = rental.daysLate

  const share = whatsappLink(
    rental.customerPhone,
    `Hello ${rental.customerName}, this is ${business?.name ?? "us"} about rental ${rental.code}. ` +
      `${plural(rental.unitsOut, "item")} ${rental.unitsOut === 1 ? "is" : "are"} ${plural(days, "day")} overdue. ` +
      `Could you let us know when you can return ${rental.unitsOut === 1 ? "it" : "them"}?`,
  )

  return (
    <li className="group flex items-stretch gap-3 rounded-r-md py-2.5 transition-colors hover:bg-accent/40 sm:gap-4">
      <DayBlock days={days} />

      <Link href={`/rentals/${rental.id}`} className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="truncate font-medium group-hover:underline">{rental.customerName}</span>
          <span className="font-mono text-xs text-muted-foreground">{rental.code}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <span>{plural(rental.unitsOut, "unit")} still out</span>
          {rental.balance > 0 && (
            <span className="font-medium text-foreground">{money(rental.balance, currency)} owed</span>
          )}
        </div>
      </Link>

      {/* The next action after reading this row is ringing the customer, so the number is
          here rather than two screens away. Hidden when we have no number for them. */}
      {rental.customerPhone && (
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={`tel:${rental.customerPhone}`}
            aria-label={`Call ${rental.customerName} on ${rental.customerPhone}`}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Phone className="size-4" />
          </a>
          {share && (
            <a
              href={share}
              target="_blank"
              rel="noreferrer"
              aria-label={`Message ${rental.customerName} on WhatsApp`}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <MessageCircle className="size-4" />
            </a>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * How late, as a block you can rank by eye.
 *
 * Three steps rather than a continuous scale, because the useful question is not "how many
 * days" but "is this a nudge, a problem, or a loss":
 *   1–3 days   a nudge — people are late, it happens
 *   4–14 days  a problem worth chasing properly
 *   15+ days   treat the stock as at risk
 */
function DayBlock({ days }: { days: number }) {
  const tone =
    days >= 15
      ? "bg-destructive text-white dark:bg-destructive/90"
      : days >= 4
        ? "bg-destructive/15 text-destructive ring-1 ring-destructive/30"
        : "bg-warning-soft text-warning-soft-foreground ring-1 ring-warning/30"

  return (
    <div
      className={cn("flex w-14 shrink-0 flex-col items-center justify-center rounded-md px-1 py-1.5 sm:w-16", tone)}
    >
      <span className="text-xl leading-none font-semibold tabular-nums">{count(days)}</span>
      <span className="mt-0.5 text-[10px] leading-none">{days === 1 ? "day" : "days"}</span>
    </div>
  )
}

/** Shown on the dashboard when the business has nothing out at all yet. */
export function NothingOutYet() {
  return (
    <section className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Nothing has gone out yet. Scan an item to rent it out and it will show up here.
      </p>
      <ButtonLink href="/rent-out" className="mt-4">
        Rent something out
      </ButtonLink>
    </section>
  )
}
