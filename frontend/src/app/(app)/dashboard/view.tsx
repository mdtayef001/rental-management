"use client"

import { useState } from "react"
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
  PiggyBank,
  Undo2,
  Wallet,
  Warehouse,
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
import { PageHeader, StatCard } from "@/components/common"
import { OverdueList } from "@/components/overdue-list"
import { useCanAccess, useCurrency, useCurrentUser, useHasPermission, useSettings } from "@/components/session"
import {
  useActivity,
  useRentalSummary,
  useRevenueReport,
  useStockSummary,
  useSupplierDebtSummary,
  useSupplierReturnSummary,
} from "@/lib/data/queries"
import { count, friendlyDateTime, money, plural } from "@/lib/format"
import { iso } from "@/lib/reports"
import { cn } from "@/lib/utils"

const DAYS = 30

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

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

  // Everything waiting on somebody, worst first, and only what this person may open.
  const attention: { href: string; icon: LucideIcon; label: string; detail: string; tone: Tone }[] = []
  if (summary?.overdue)
    attention.push({
      href: "/rentals?status=overdue",
      icon: CalendarClock,
      label: plural(summary.overdue, "rental") + " overdue",
      detail: `${count(summary.unitsOut)} units out`,
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
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Out on rent"
          value={count(summary?.unitsOut ?? 0)}
          hint={summary ? plural(summary.open, "open rental") : undefined}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {canSeeMoney && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Earned per day</CardTitle>
              <CardDescription>
                The last {DAYS} days. Rent is counted when items come back, which is when the price is finally known.
              </CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" render={<Link href="/reports" />}>
                  Reports
                  <ArrowRight className="size-4" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {revenue.isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : (revenue.data?.results.length ?? 0) === 0 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">
                  Nothing has come back in the last {DAYS} days, so nothing has been charged yet.
                </p>
              ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
                  <LineChart data={revenue.data?.results ?? []} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.5} />
                    <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={day} />
                    <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => short(Number(v))} />
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

        <Card className={canSeeMoney ? undefined : "lg:col-span-3"}>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>{attention.length ? "Open one to deal with it." : "Nothing is waiting on you."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-0.5">
            {attention.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/60"
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

      <div className={cn("grid gap-4", canSeeActivity ? "lg:grid-cols-3" : "lg:grid-cols-1")}>
        <div className={canSeeActivity ? "lg:col-span-2" : undefined}>
          <OverdueList />
        </div>

        {canSeeActivity && (
          <Card>
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
              ) : (activity.data?.results.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {activity.data?.results.map((entry) => (
                    <li key={entry.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="font-medium">{entry.action}</div>
                      {entry.detail && <div className="truncate text-xs text-muted-foreground">{entry.detail}</div>}
                      <div className="text-xs text-muted-foreground">
                        {entry.userName || "System"} · {friendlyDateTime(entry.at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Context rather than action: useful to know, nothing to do about it today. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 text-sm sm:flex sm:flex-wrap sm:gap-x-10">
        <Quiet label="Rent earned this month" value={money(summary?.revenueMonth ?? 0, currency)} />
        <Quiet label="Deposits held" value={money(summary?.depositsHeld ?? 0, currency)} icon={PiggyBank} />
        <Quiet label="Came back today" value={count(summary?.returnedToday ?? 0)} />
        <Quiet
          label="Low stock"
          value={count(stock?.lowStock ?? 0)}
          href={stock?.lowStock ? "/products?filter=lowStock" : undefined}
          warn={!!stock?.lowStock}
        />
        <Quiet label="On the shelf" value={`${count(stock?.units ?? 0)} units`} icon={Warehouse} />
      </dl>
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
  icon?: LucideIcon
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 font-medium tabular-nums",
          warn && "text-warning-soft-foreground dark:text-warning",
        )}
      >
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
