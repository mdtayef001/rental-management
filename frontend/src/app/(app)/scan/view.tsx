"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Camera,
  Keyboard,
  Package,
  SearchX,
  Type,
  Undo2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader, Spinner, StatCard } from "@/components/common"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useBranchScope, useCurrency } from "@/components/session"
import { useLookup, useProductSearch, useRentalSummary } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"
import type { ProductLookup } from "@/lib/types"

/**
 * The counter screen: find an item, then decide what to do with it.
 *
 * Three ways in, as tabs, because a shop has three situations: a gun scanner at the
 * counter, a phone camera in the aisle, and a label torn off so the name is all anyone
 * has. Only one is on screen at a time, so the camera is never a video panel pushing the
 * answer below the fold — and the answer always lands in the same place, directly under
 * the tabs.
 *
 * It deliberately doesn't decide what to do with a scan: a product could mean renting out
 * or taking back, and only the person at the counter knows which.
 */
export function ScanView({ canRent, canTakeReturns }: { canRent: boolean; canTakeReturns: boolean }) {
  const { defaultBranchId } = useBranchScope()
  const [tab, setTab] = useState("type")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")

  const lookup = useLookup(code)
  const suggestions = useProductSearch(name, { enabled: tab === "name" && name.trim().length > 1 })
  const { data: summary } = useRentalSummary({ live: true })

  function pick(product: ProductLookup) {
    setName("")
    setTab("type")
    setCode(product.barcode || product.sku)
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader title="Scan" description="Find an item to rent out or take back. A USB scanner works here too.">
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

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="type" className="py-2">
            <Keyboard className="size-4" />
            <span className="hidden sm:inline">Type or</span> scan
          </TabsTrigger>
          <TabsTrigger value="camera" className="py-2">
            <Camera className="size-4" />
            Camera
          </TabsTrigger>
          <TabsTrigger value="name" className="py-2">
            <Type className="size-4" />
            By name
          </TabsTrigger>
        </TabsList>

        <TabsContent value="type" className="mt-4">
          <CodeInput
            onSubmit={setCode}
            autoFocus
            busy={lookup.isFetching}
            placeholder="Scan or type a barcode / SKU, then press Enter"
          />
        </TabsContent>

        <TabsContent value="camera" className="mt-4">
          {/* Mounted only while this tab is open, so the device camera is released the
              moment someone switches away from it. */}
          <div className="mx-auto max-w-sm">
            {tab === "camera" && (
              <CameraScanner
                onDetected={(scanned) => {
                  setTab("type")
                  setCode(scanned)
                }}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="name" className="mt-4 space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Part of the product name, e.g. “sewing”"
            aria-label="Search products by name"
            autoFocus
          />
          {name.trim().length > 1 &&
            (suggestions.isFetching && (suggestions.data?.length ?? 0) === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Searching for “{name.trim()}”…
              </p>
            ) : (suggestions.data?.length ?? 0) === 0 ? (
              <p className="rounded-lg border border-dashed bg-card/40 p-5 text-sm text-muted-foreground">
                No product matches “{name.trim()}”. Check the spelling, or scan the label.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {suggestions.data?.slice(0, 8).map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => pick(product)}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-accent/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{product.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{product.sku}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </TabsContent>
      </Tabs>

      {lookup.isFetching ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Looking up {code}…
        </p>
      ) : lookup.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <SearchX className="size-9 text-warning" />
            <p className="font-medium">
              No product uses <code className="font-mono">{code}</code>
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Try the name instead, or{" "}
              <Link href="/products" className="underline underline-offset-4">
                open the products list
              </Link>
              .
            </p>
            <Button variant="outline" onClick={() => setCode("")}>
              Scan something else
            </Button>
          </CardContent>
        </Card>
      ) : lookup.data ? (
        <Found
          product={lookup.data}
          onHand={lookup.data.stock[defaultBranchId] ?? 0}
          canRent={canRent}
          canTakeReturns={canTakeReturns}
        />
      ) : null}

      {/* Context, not the task: last, and still one glance. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Out on rent"
          value={count(summary?.unitsOut ?? 0)}
          hint={summary ? plural(summary.open, "rental") : undefined}
          icon={Package}
          href="/rentals"
        />
        <StatCard
          label="Due back today"
          value={count(summary?.dueToday ?? 0)}
          icon={CalendarClock}
          tone={summary?.dueToday ? "warning" : "default"}
          href="/rentals?status=due_today"
        />
        <StatCard
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          hint={summary?.overdue ? "Chase these up" : "Nothing late"}
          icon={AlertTriangle}
          tone={summary?.overdue ? "danger" : "good"}
          href="/rentals?status=overdue"
        />
      </div>
    </div>
  )
}

/** One found product: what it is, how many are on the shelf, and the two things to do with it. */
function Found({
  product,
  onHand,
  canRent,
  canTakeReturns,
}: {
  product: ProductLookup
  onHand: number
  canRent: boolean
  canTakeReturns: boolean
}) {
  const currency = useCurrency()
  const code = encodeURIComponent(product.barcode || product.sku)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="font-heading text-lg">{product.name}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {product.sku}
          </Badge>
          {product.category && <span>{product.category}</span>}
          {!product.rentable && <Badge variant="secondary">Not for rent</Badge>}
        </CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 self-center text-right">
          <div className="font-heading text-[1.75rem] leading-tight font-semibold tabular-nums">{count(onHand)}</div>
          <div className="text-xs text-muted-foreground">on the shelf</div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {product.rentable && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {product.rentDaily != null && (
              <span>
                <strong className="tabular-nums">{money(product.rentDaily, currency)}</strong> / day
              </span>
            )}
            {product.rentWeekly != null && (
              <span>
                <strong className="tabular-nums">{money(product.rentWeekly, currency)}</strong> / week
              </span>
            )}
            {product.rentMonthly != null && (
              <span>
                <strong className="tabular-nums">{money(product.rentMonthly, currency)}</strong> / month
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canRent && product.rentable && (
            <ButtonLink href={`/rent-out?code=${code}`} disabled={onHand === 0}>
              <Package className="size-4" />
              Rent this out
              <ArrowRight className="size-4" />
            </ButtonLink>
          )}
          {canTakeReturns && (
            <ButtonLink href={`/take-back?code=${code}`} variant="outline">
              <Undo2 className="size-4" />
              Take one back
            </ButtonLink>
          )}
          <ButtonLink href={`/products/${product.id}`} variant="ghost">
            Product details
          </ButtonLink>
        </div>

        {onHand === 0 && product.rentable && (
          <p className="text-sm text-warning-soft-foreground dark:text-warning">
            None on the shelf — they may all be out on rent.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
