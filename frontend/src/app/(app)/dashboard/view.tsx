"use client"

import Link from "next/link"
import { Package, Undo2 } from "lucide-react"
import { ButtonLink } from "@/components/ui/button-link"
import { Skeleton } from "@/components/ui/skeleton"
import { NothingOutYet, OverdueList } from "@/components/overdue-list"
import { useCurrency } from "@/components/session"
import { useRentalSummary, useStockSummary } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * What the owner wants to know on walking in: what's out, what's late, what's owed.
 *
 * Arranged by urgency rather than by category. Four figures that answer "how is the shop",
 * then the chase list — the only thing on the page that asks anyone to do something, and
 * so the only thing allowed to be loud — then the quieter money figures underneath.
 *
 * Every figure is one database aggregate, so the page costs the same at 50 rentals as at
 * 50,000.
 */
export function DashboardView({ businessName }: { businessName: string }) {
  const currency = useCurrency()
  const { data: summary, isLoading } = useRentalSummary({ live: true })
  const { data: stock } = useStockSummary()

  const nothingEverRented = !isLoading && summary && summary.open === 0 && summary.unitsOut === 0

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{businessName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isLoading
              ? "Loading today's figures…"
              : summary?.open
                ? `${plural(summary.open, "rental")} out, ${count(summary.unitsOut)} units with customers.`
                : "Nothing is out on rent right now."}
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/take-back" variant="outline">
            <Undo2 className="size-4" />
            Take back
          </ButtonLink>
          <ButtonLink href="/rent-out">
            <Package className="size-4" />
            Rent out
          </ButtonLink>
        </div>
      </header>

      {/* The shape of today. Four figures, no more — anything else belongs in the strip below. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        <Figure label="Units out" value={count(summary?.unitsOut ?? 0)} loading={isLoading} />
        <Figure
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          loading={isLoading}
          tone={summary?.dueToday ? "warn" : undefined}
        />
        <Figure
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          loading={isLoading}
          tone={summary?.overdue ? "bad" : undefined}
        />
        <Figure
          label="Owed by customers"
          value={money(summary?.owed ?? 0, currency)}
          loading={isLoading}
          tone={summary?.owed ? "warn" : undefined}
        />
      </div>

      {nothingEverRented ? <NothingOutYet /> : <OverdueList />}

      {/* Everything that is useful to know but needs no action today. Deliberately a plain
          strip, not more cards, so it cannot compete with the chase list above it. */}
      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t pt-5 text-sm">
        <Quiet label="Rent earned this month" value={money(summary?.revenueMonth ?? 0, currency)} />
        <Quiet label="Deposits held" value={money(summary?.depositsHeld ?? 0, currency)} />
        <Quiet label="Came back today" value={count(summary?.returnedToday ?? 0)} />
        <Quiet
          label="Low stock"
          value={count(stock?.lowStock ?? 0)}
          href={stock?.lowStock ? "/stock?lowStock=1" : undefined}
        />
        <Quiet label="On the shelf" value={`${count(stock?.units ?? 0)} units`} />
      </dl>
    </div>
  )
}

function Figure({
  label,
  value,
  tone,
  loading,
}: {
  label: string
  value: string
  tone?: "warn" | "bad"
  loading?: boolean
}) {
  return (
    <div className="bg-background p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div
          className={cn(
            "mt-1 text-[1.75rem] leading-tight font-semibold tabular-nums",
            tone === "warn" && "text-amber-600 dark:text-amber-500",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
      )}
    </div>
  )
}

function Quiet({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </>
  )
  return href ? (
    <Link href={href} className="underline-offset-4 hover:underline">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  )
}
