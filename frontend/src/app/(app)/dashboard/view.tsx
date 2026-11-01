"use client"

import Link from "next/link"
import { AlertTriangle, Boxes, CalendarClock, Package, ScanLine, Undo2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState, PageHeader, StatTile, TableSkeleton } from "@/components/common"
import { useCurrency } from "@/components/session"
import { useRentals, useRentalSummary, useStockSummary } from "@/lib/data/queries"
import { count, dueLabel, money, plural } from "@/lib/format"

/**
 * What the owner wants to know on walking in: what's out, what's late, what's owed.
 *
 * Every tile is one database aggregate rather than a list the browser counts, so this page
 * loads the same whether the shop has 50 rentals or 50,000.
 */
export function DashboardView({ businessName }: { businessName: string }) {
  const currency = useCurrency()
  const { data: summary, isLoading } = useRentalSummary({ live: true })
  const { data: stock } = useStockSummary()
  // Just the first few overdue rentals: the full list is one click away.
  const overdue = useRentals({ page: 1, status: "overdue", sort: "due" }, { pageSize: 5 })

  return (
    <div className="space-y-6">
      <PageHeader title={businessName} description="Today at a glance.">
        <ButtonLink href="/take-back" variant="outline">
            <Undo2 className="size-4" />
            Take back
          </ButtonLink>
        <ButtonLink href="/rent-out">
            <Package className="size-4" />
            Rent out
          </ButtonLink>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Units out on rent"
          value={count(summary?.unitsOut ?? 0)}
          hint={plural(summary?.open ?? 0, "open rental")}
          loading={isLoading}
        />
        <StatTile
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          tone={summary?.dueToday ? "warning" : "default"}
          loading={isLoading}
        />
        <StatTile
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          tone={summary?.overdue ? "danger" : "good"}
          hint={summary?.overdue ? "Needs chasing" : "Nothing late"}
          loading={isLoading}
        />
        <StatTile
          label="Still owed"
          value={money(summary?.owed ?? 0, currency)}
          tone={summary?.owed ? "warning" : "default"}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Rent this month" value={money(summary?.revenueMonth ?? 0, currency)} loading={isLoading} />
        <StatTile label="Deposits held" value={money(summary?.depositsHeld ?? 0, currency)} loading={isLoading} />
        <StatTile label="Returned today" value={count(summary?.returnedToday ?? 0)} loading={isLoading} />
        <StatTile
          label="Low stock"
          value={count(stock?.lowStock ?? 0)}
          tone={stock?.lowStock ? "warning" : "default"}
          hint={`${count(stock?.units ?? 0)} units on the shelf`}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" />
            Overdue rentals
          </CardTitle>
          <ButtonLink href="/rentals?status=overdue" variant="ghost" size="sm">See all</ButtonLink>
        </CardHeader>
        <CardContent>
          {overdue.isLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : overdue.data?.results.length === 0 ? (
            <EmptyState
              title="Nothing overdue"
              description="Every rental is either within its date or already back."
              icon={CalendarClock}
            />
          ) : (
            <ul className="divide-y">
              {overdue.data?.results.map((rental) => (
                <li key={rental.id}>
                  <Link
                    href={`/rentals/${rental.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{rental.customerName}</div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-mono text-xs">{rental.code}</span> ·{" "}
                        {plural(rental.unitsOut, "unit")} out
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div className="font-medium text-destructive">{dueLabel(rental.dueAt)}</div>
                      {rental.balance > 0 && (
                        <div className="text-muted-foreground tabular-nums">
                          {money(rental.balance, currency)} owed
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink href="/scan" icon={ScanLine} label="Scan an item" hint="Look something up by barcode" />
        <QuickLink href="/rentals?status=open" icon={Boxes} label="Everything out" hint="Open rentals" />
        <QuickLink href="/rentals?status=unpaid" icon={Wallet} label="Unpaid" hint="Rentals with a balance" />
      </div>
    </div>
  )
}

function QuickLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
}) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border p-4 transition hover:bg-accent/60">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate font-medium">{label}</div>
        <div className="truncate text-sm text-muted-foreground">{hint}</div>
      </div>
    </Link>
  )
}
