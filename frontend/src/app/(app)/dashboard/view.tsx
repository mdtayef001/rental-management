"use client"

import Link from "next/link"
import { Banknote, Package, PiggyBank, TriangleAlert, Undo2, Warehouse } from "lucide-react"
import { ButtonLink } from "@/components/ui/button-link"
import { PageHeader, StatGrid, StatTile } from "@/components/common"
import { NothingOutYet, OverdueList } from "@/components/overdue-list"
import { useCurrency } from "@/components/session"
import { useRentalSummary, useStockSummary } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"

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
    <div className="space-y-6">
      <PageHeader
        title={businessName}
        description={
          isLoading
            ? "Loading today's figures…"
            : summary?.open
              ? `${plural(summary.open, "rental")} out, ${count(summary.unitsOut)} units with customers.`
              : "Nothing is out on rent right now."
        }
      >
        <ButtonLink href="/take-back" variant="outline">
          <Undo2 className="size-4" />
          Take back
        </ButtonLink>
        <ButtonLink href="/rent-out">
          <Package className="size-4" />
          Rent out
        </ButtonLink>
      </PageHeader>

      {/* The shape of today. Four figures, no more — anything else belongs in the strip
          below. Each one links to the list it summarises, because the next thing anyone
          does with a number they don't like is look at what is behind it. */}
      <StatGrid>
        <StatTile label="Units out" value={count(summary?.unitsOut ?? 0)} icon={Package} loading={isLoading} href="/rentals" />
        <StatTile
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          icon={Undo2}
          loading={isLoading}
          tone={summary?.dueToday ? "warning" : "default"}
          href="/rentals?status=due_today"
        />
        <StatTile
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          icon={TriangleAlert}
          loading={isLoading}
          tone={summary?.overdue ? "danger" : "default"}
          hint={summary?.overdue ? "Chase these up" : "Nothing late"}
          href="/rentals?status=overdue"
        />
        <StatTile
          label="Owed by customers"
          value={money(summary?.owed ?? 0, currency)}
          icon={Banknote}
          loading={isLoading}
          tone={summary?.owed ? "warning" : "default"}
        />
      </StatGrid>

      {nothingEverRented ? <NothingOutYet /> : <OverdueList />}

      {/* Everything useful to know that needs no action today. Deliberately a plain strip
          rather than more tiles, so it cannot compete with the chase list above it. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 text-sm sm:flex sm:flex-wrap sm:gap-x-10">
        <Quiet label="Rent earned this month" value={money(summary?.revenueMonth ?? 0, currency)} />
        <Quiet label="Deposits held" value={money(summary?.depositsHeld ?? 0, currency)} icon={PiggyBank} />
        <Quiet label="Came back today" value={count(summary?.returnedToday ?? 0)} />
        <Quiet
          label="Low stock"
          value={count(stock?.lowStock ?? 0)}
          href={stock?.lowStock ? "/stock?lowStock=1" : undefined}
          warn={!!stock?.lowStock}
        />
        <Quiet label="On the shelf" value={`${count(stock?.units ?? 0)} units`} icon={Warehouse} />
      </dl>
    </div>
  )
}

function Quiet({
  label,
  value,
  href,
  warn,
  icon: Icon,
}: {
  label: string
  value: string
  href?: string
  warn?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </dt>
      <dd className={warn ? "mt-0.5 font-medium tabular-nums text-warning-soft-foreground dark:text-warning" : "mt-0.5 font-medium tabular-nums"}>
        {value}
      </dd>
    </>
  )
  return href ? (
    <Link href={href} className="rounded-sm underline-offset-4 hover:underline">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  )
}
