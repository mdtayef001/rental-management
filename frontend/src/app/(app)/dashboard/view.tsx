"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  type LucideIcon,
  Package,
  PackageX,
  Undo2,
  Wallet,
} from "lucide-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ErrorState, PageHeader, StatCard } from "@/components/common"
import { useCanAccess, useCurrency, useCurrentUser, useHasPermission, useSettings } from "@/components/session"
import {
  useActivity,
  useRentalSummary,
  useRevenueReport,
  useStockSummary,
  useSupplierDebtSummary,
  useSupplierReturnSummary,
} from "@/lib/data/queries"
import { compactMoney, count, friendlyDateTime, money, plural } from "@/lib/format"
import { iso } from "@/lib/reports"
import { cn } from "@/lib/utils"

const DAYS = 30

/** Whether the browser has taken over is a fact that never changes again, so it never emits. */
const subscribeNever = () => () => {}

const chartConfig = { revenue: { label: "Earned", color: "var(--chart-1)" } } satisfies ChartConfig

/**
 * What the owner wants to know on walking in.
 *
 * Four figures for the shape of the day, then the two questions that actually make
 * someone move: what is earning, and what is waiting on me. The chase list of overdue
 * rentals is last and loudest, because it is the one thing on the page with a phone
 * number attached.
 *
 * Every figure is a single database aggregate, so the page costs the same at 50 rentals
 * as at 50,000, and each tile links to the list behind it — the next thing anyone does
 * with a number they don't like is look at what is in it.
 */
export function DashboardView({ businessName }: { businessName: string }) {
  const user = useCurrentUser()
  const currency = useCurrency()
  const settings = useSettings()

  const canSeeMoney = useHasPermission("managerProfit")
  const canSeePurchases = useCanAccess("/purchases") && settings.modules.purchases
  const canSeeActivity = useCanAccess("/activity")

  const { data: summary, isLoading } = useRentalSummary({ live: true })
  const { data: stock } = useStockSummary()
  const { data: debt } = useSupplierDebtSummary(canSeePurchases)
  const { data: sentBack } = useSupplierReturnSummary({ status: "open" }, canSeePurchases)
  const activity = useActivity({ page: 1 }, { pageSize: 6, enabled: canSeeActivity })

  // Fixed when the page opens, so the query key doesn't change under the chart.
  const [range] = useState(() => ({
    from: iso(new Date(Date.now() - (DAYS - 1) * 86_400_000)),
    to: iso(new Date()),
  }))
  const revenue = useRevenueReport(range, "day", canSeeMoney)

  // The hour is the reader's, not the server's. Rendering it during SSR would greet a
  // shop in Dhaka with the time in whatever zone the server happens to run in, and React
  // would tear the text down on hydration; so the greeting waits for the browser.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)
  const hour = new Date().getHours()
  const greeting = !hydrated ? null : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

  // The series the server sends has a row only for days something came back, so two
  // returns a month apart would be drawn as one long slope between neighbouring points.
  // Filling the quiet days with zero makes the axis a real calendar and the gaps visible.
  const series = useMemo(() => {
    const rows = revenue.data?.results ?? []
    if (rows.length === 0) return []
    const earned = new Map(rows.map((row) => [row.period, row.revenue]))
    const start = new Date(range.from + "T00:00")
    return Array.from({ length: DAYS }, (_, i) => {
      const period = iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
      return { period, revenue: earned.get(period) ?? 0 }
    })
  }, [revenue.data, range.from])

  // Everything waiting on somebody, worst first, and only what this person may open.
  const attention: { href: string; icon: LucideIcon; label: string; detail: string; tone: Tone }[] = []
  if (summary?.overdue)
    attention.push({
      href: "/rentals?status=overdue",
      icon: CalendarClock,
      label: "Rentals overdue",
      detail: count(summary.overdue),
      tone: "danger",
    })
  if (summary?.dueToday)
    attention.push({
      href: "/rentals?status=due_today",
      icon: Undo2,
      label: "Due back today",
      detail: count(summary.dueToday),
      tone: "warning",
    })
  if (summary?.owed)
    attention.push({
      href: "/rentals?status=unpaid",
      icon: Banknote,
      label: "Unpaid by customers",
      detail: money(summary.owed, currency),
      tone: "warning",
    })
  if (stock?.lowStock)
    attention.push({
      href: "/products?filter=lowStock",
      icon: AlertTriangle,
      label: "Products running low",
      detail: count(stock.lowStock),
      tone: "warning",
    })
  if (debt?.overdue)
    attention.push({
      href: "/suppliers",
      icon: Wallet,
      label: "Supplier bills past due",
      detail: money(debt.overdue, currency),
      tone: "danger",
    })
  if (sentBack?.open)
    attention.push({
      href: "/supplier-returns",
      icon: PackageX,
      label: "Waiting on suppliers",
      detail: `${count(sentBack.open)} · ${money(sentBack.outstanding, currency)} back`,
      tone: "info",
    })

  return (
    <div>
      <PageHeader
        title={greeting ? `${greeting}, ${user.name.split(" ")[0]}` : user.name.split(" ")[0]}
        description={
          isLoading
            ? `Loading today's figures for ${businessName}…`
            : summary?.open
              ? `${plural(summary.open, "rental")} out at ${businessName}, ${count(summary.unitsOut)} units with customers.`
              : `Nothing is out on rent at ${businessName} right now.`
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

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Out on rent"
          value={count(summary?.unitsOut ?? 0)}
          hint={
            summary
              ? `${plural(summary.open, "open rental")}${stock ? ` · ${count(stock.units)} on the shelf` : ""}`
              : undefined
          }
          icon={Package}
          loading={isLoading}
          href="/rentals"
        />
        <StatCard
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          hint={summary?.returnedToday ? `${count(summary.returnedToday)} already came back` : "Nothing back yet today"}
          icon={CalendarClock}
          tone={summary?.dueToday ? "warning" : "default"}
          loading={isLoading}
          href="/rentals?status=due_today"
        />
        <StatCard
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          hint={summary?.overdue ? "Chase these up" : "Nothing late"}
          icon={AlertTriangle}
          tone={summary?.overdue ? "danger" : "good"}
          loading={isLoading}
          href="/rentals?status=overdue"
        />
        <StatCard
          label="Owed by customers"
          value={money(summary?.owed ?? 0, currency)}
          hint={`${money(summary?.depositsHeld ?? 0, currency)} held as deposits`}
          icon={Banknote}
          tone={summary?.owed ? "warning" : "good"}
          loading={isLoading}
          href="/rentals?status=unpaid"
        />
      </div>

      {/* What is earning, beside what is waiting on someone. */}
      <div className={cn("mt-8 grid gap-4", canSeeMoney && "lg:grid-cols-2")}>
        {canSeeMoney && (
            <Card className="h-full">
              <CardHeader>
                {/* The month's total sits beside the title in the series' own colour, so the
                    figure and the line below it read as the same thing. Rounded, because a
                    number read in passing only has to carry its size — the exact amount is
                    one hover away, and every row of it is in Reports. */}
                <CardTitle className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span>Earned</span>
                  <span className="flex items-baseline gap-1.5">
                  {isLoading ? (
                    <Skeleton className="h-6 w-20" />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="cursor-default font-heading text-xl font-semibold tracking-tight text-[var(--chart-1)] tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          />
                        }
                      >
                        {compactMoney(summary?.revenueMonth ?? 0, currency)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {money(summary?.revenueMonth ?? 0, currency)} earned this month
                      </TooltipContent>
                    </Tooltip>
                  )}
                    <span className="text-xs font-normal text-muted-foreground">this month</span>
                  </span>
                </CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" render={<Link href="/reports" />}>
                    Reports
                    <ArrowRight className="size-4" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                {revenue.isLoading ? (
                  <Skeleton className="min-h-56 w-full flex-1" />
                ) : revenue.isError ? (
                  <ErrorState error={revenue.error} onRetry={() => revenue.refetch()} />
                ) : series.length === 0 ? (
                  <p className="py-20 text-center text-sm text-muted-foreground">
                    Nothing has come back in the last {DAYS} days, so nothing has been charged yet.
                  </p>
                ) : (
                  <ChartContainer config={chartConfig} className="aspect-auto min-h-56 w-full flex-1">
                    <LineChart accessibilityLayer data={series} margin={{ left: 12, right: 16, top: 8 }}>
                      <CartesianGrid vertical={false} strokeOpacity={0.5} />
                      <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={day} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        // Headroom, so the best day isn't drawn flush against the lid.
                        domain={[0, (max: number) => Math.max(1000, Math.ceil((max * 1.15) / 1000) * 1000)]}
                        tickFormatter={(v) => short(Number(v))}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_, payload) => (payload?.[0] ? day(String(payload[0].payload.period)) : "")}
                            formatter={(value) => (
                              <div className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">Earned</span>
                                <span className="font-medium tabular-nums">{money(Number(value), currency)}</span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Line dataKey="revenue" type="linear" stroke="var(--color-revenue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
        )}

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>{attention.length ? "Open one to deal with it." : "Nothing is waiting on you."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center gap-0.5">
            {attention.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    item.tone === "danger" && "bg-destructive-soft text-destructive-soft-foreground",
                    item.tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
                    item.tone === "info" && "bg-info-soft text-info-soft-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 font-medium">{item.label}</span>
                <span className="shrink-0 text-right tabular-nums text-muted-foreground">{item.detail}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            {attention.length === 0 && (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" />
                All caught up.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The team's trail. Full width, because each line reads left to right: what
          happened and to which record, then who did it and when. */}
      {canSeeActivity && (
        <Card className="mt-12">
              <CardHeader>
                <CardTitle>Latest activity</CardTitle>
                <CardDescription>What the team has been doing.</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" render={<Link href="/activity" />}>
                    All
                    <ArrowRight className="size-4" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {activity.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : activity.isError ? (
                  <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
                ) : (activity.data?.results.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  // Across the full width each line reads straight through: what happened
                  // and to which record on the left, who did it and when on the right.
                  <ul className="divide-y text-sm">
                    {activity.data?.results.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-col gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline"
                      >
                        <span className="shrink-0 font-medium">{entry.action}</span>
                        {entry.detail && (
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.detail}</span>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto sm:text-right">
                          {entry.userName || "System"} · {friendlyDateTime(entry.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
      )}
    </div>
  )
}

type Tone = "danger" | "warning" | "info"

/** "2026-11-01" → "1 Nov", the way the axis and the tooltip both want it. */
function day(period: string) {
  return new Date(period + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** Axis labels: "12k" rather than "12,000", so the numbers fit without turning sideways. */
function short(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`
  return String(value)
}

