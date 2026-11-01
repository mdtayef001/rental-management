"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, Package, ScanLine, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader, Spinner, StatTile } from "@/components/common"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useBranchScope, useCurrency } from "@/components/session"
import { useLookup, useRentalSummary } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"

/**
 * The counter screen: scan anything and the app works out what you probably want.
 *
 * Staff land here after logging in. One scan shows the item, how many are on the shelf and
 * how many are out — then offers the two things they might do with it. It deliberately
 * doesn't decide for them: scanning a product could mean renting it out or taking it back,
 * and only the person at the counter knows which.
 */
export function ScanView({ canRent, canTakeReturns }: { canRent: boolean; canTakeReturns: boolean }) {
  const router = useRouter()
  const currency = useCurrency()
  const { defaultBranchId, showPicker, branches } = useBranchScope()
  const [branchId, setBranchId] = useState(defaultBranchId)
  const [code, setCode] = useState("")

  const lookup = useLookup(code)
  const { data: summary } = useRentalSummary({ live: true })

  const onHand = lookup.data ? (lookup.data.stock[branchId] ?? 0) : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Scan" description="Scan an item to rent it out or take it back.">
        {canTakeReturns && (
          <ButtonLink href="/take-back" variant="outline">
              <Undo2 className="size-4" />
              Take back
            </ButtonLink>
        )}
        {canRent && (
          <ButtonLink href="/rent-out">
              <Package className="size-4" />
              Rent out
            </ButtonLink>
        )}
      </PageHeader>

      {/* Today at a glance: the three numbers that decide what staff do next. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Out on rent" value={count(summary?.unitsOut ?? 0)} hint={plural(summary?.open ?? 0, "rental")} />
        <StatTile
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          tone={summary?.dueToday ? "warning" : "default"}
        />
        <StatTile
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          tone={summary?.overdue ? "danger" : "good"}
          hint={summary?.overdue ? "Chase these up" : "Nothing late"}
        />
      </div>

      {showPicker && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="branch" className="text-muted-foreground">
            Branch
          </label>
          <select
            id="branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scan or type a code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeInput onSubmit={setCode} autoFocus />
          <CameraScanner onDetected={setCode} />
        </CardContent>
      </Card>

      {lookup.isFetching && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Looking up {code}…
        </div>
      )}

      {lookup.isError && (
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-6">
          <AlertTriangle className="mt-0.5 size-5 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">Nothing matches that code</p>
            <p className="text-sm text-muted-foreground">
              {lookup.error instanceof Error ? lookup.error.message : "Try another code."} You can also{" "}
              <Link href="/products" className="underline">
                search the products list
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {lookup.data && !lookup.isFetching && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{lookup.data.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="font-mono text-xs">
                    {lookup.data.sku}
                  </Badge>
                  {lookup.data.category && <span>{lookup.data.category}</span>}
                  {!lookup.data.rentable && <Badge variant="secondary">Not for rent</Badge>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums">{count(onHand)}</div>
                <div className="text-xs text-muted-foreground">on the shelf</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {lookup.data.rentable && (
              <div className="flex flex-wrap gap-4 text-sm">
                {lookup.data.rentDaily != null && (
                  <span>
                    <strong>{money(lookup.data.rentDaily, currency)}</strong> / day
                  </span>
                )}
                {lookup.data.rentWeekly != null && (
                  <span>
                    <strong>{money(lookup.data.rentWeekly, currency)}</strong> / week
                  </span>
                )}
                {lookup.data.rentMonthly != null && (
                  <span>
                    <strong>{money(lookup.data.rentMonthly, currency)}</strong> / month
                  </span>
                )}
                {lookup.data.deposit > 0 && (
                  <span className="text-muted-foreground">
                    Deposit {money(lookup.data.deposit, currency)} each
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {canRent && lookup.data.rentable && (
                <ButtonLink
                  href={`/rent-out?code=${encodeURIComponent(lookup.data.barcode || lookup.data.sku)}`}
                  disabled={onHand === 0}
                >
                  <Package className="size-4" />
                  Rent this out
                  <ArrowRight className="size-4" />
                </ButtonLink>
              )}
              {canTakeReturns && (
                <ButtonLink
                  href={`/take-back?code=${encodeURIComponent(lookup.data.barcode || lookup.data.sku)}`}
                  variant="outline"
                >
                  <Undo2 className="size-4" />
                  Take one back
                </ButtonLink>
              )}
              <ButtonLink href={`/products/${lookup.data.id}`} variant="ghost">
                Product details
              </ButtonLink>
            </div>

            {onHand === 0 && lookup.data.rentable && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                None are on the shelf at this branch — they may all be out on rent.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!lookup.data && !lookup.isFetching && !lookup.isError && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ScanLine className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Scan a barcode, or type a SKU and press Enter. A USB scanner works too.
          </p>
        </div>
      )}
    </div>
  )
}
