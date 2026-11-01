"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Camera, CameraOff, Package, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { PageHeader, Spinner } from "@/components/common"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useBranchScope, useCurrency } from "@/components/session"
import { useLookup, useProductSearch, useRentalSummary } from "@/lib/data/queries"
import { count, money, plural } from "@/lib/format"
import type { ProductLookup } from "@/lib/types"

/**
 * The counter screen: scan anything and the app works out what you probably want.
 *
 * The layout is the whole design here. Staff stand at a counter with a customer waiting, so
 * the field comes first and the answer appears directly under it — nothing is allowed
 * between the two, because an answer below the fold is an answer nobody reads. The camera
 * is off until it's asked for, since a live video panel would push every result off the
 * screen; the day's figures sit at the bottom, where they inform without getting in the way.
 *
 * It deliberately doesn't decide what to do with a scan: a product could mean renting out
 * or taking back, and only the person at the counter knows which.
 */
export function ScanView({ canRent, canTakeReturns }: { canRent: boolean; canTakeReturns: boolean }) {
  const { defaultBranchId } = useBranchScope()
  const [code, setCode] = useState("")
  const [typed, setTyped] = useState("")
  const [camera, setCamera] = useState(false)

  const lookup = useLookup(code)
  // While someone types a name, search for it. Exact codes come back from `useLookup` on
  // Enter — this is for the half of the day when the label is torn off and staff type
  // "sewing" instead.
  const suggestions = useProductSearch(typed, { enabled: typed.trim().length > 1 && !isCode(typed) })
  const { data: summary } = useRentalSummary({ live: true })

  function pick(product: ProductLookup) {
    setTyped("")
    setCode(product.barcode || product.sku)
  }

  const showingSuggestions = typed.trim().length > 1 && !isCode(typed)

  return (
    <div className="space-y-6">
      <PageHeader title="Scan" description="Scan an item to rent it out or take it back. A USB scanner works too.">
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

      {/* The field, and nothing above it. */}
      <div className="space-y-3">
        <CodeInput value={typed} onChange={setTyped} onSubmit={setCode} autoFocus busy={lookup.isFetching}>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setCamera((on) => !on)}
            aria-pressed={camera}
          >
            {camera ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
            <span className="hidden sm:inline">{camera ? "Close camera" : "Camera"}</span>
          </Button>
        </CodeInput>

        {/* Only mounted when asked for, so the camera is released the moment it's closed —
            and so it never costs the screen space staff need for the result. */}
        {camera && (
          <div className="max-w-sm">
            <CameraScanner
              onDetected={(scanned) => {
                setCamera(false)
                setCode(scanned)
              }}
            />
          </div>
        )}
      </div>

      {/* The answer, immediately under the field. */}
      {showingSuggestions ? (
        <Suggestions
          query={typed}
          rows={suggestions.data ?? []}
          loading={suggestions.isFetching}
          onPick={pick}
        />
      ) : lookup.isFetching ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Looking up {code}…
        </p>
      ) : lookup.isError ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed bg-card/40 p-5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">Nothing matches {code}</p>
            <p className="text-sm text-muted-foreground">
              Type part of the product name to search instead, or{" "}
              <Link href="/products" className="underline">
                open the products list
              </Link>
              .
            </p>
          </div>
        </div>
      ) : lookup.data ? (
        <Found
          product={lookup.data}
          onHand={lookup.data.stock[defaultBranchId] ?? 0}
          canRent={canRent}
          canTakeReturns={canTakeReturns}
        />
      ) : null}

      {/* Context, not the task: last, quiet, and still one glance. */}
      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t pt-5 text-sm">
        <Stat label="Out on rent" value={count(summary?.unitsOut ?? 0)} hint={plural(summary?.open ?? 0, "rental")} />
        <Stat label="Due back today" value={count(summary?.dueToday ?? 0)} />
        <Stat
          label="Overdue"
          value={count(summary?.overdue ?? 0)}
          hint={summary?.overdue ? "Chase these up" : "Nothing late"}
          href={summary?.overdue ? "/rentals?status=overdue" : undefined}
          bad={!!summary?.overdue}
        />
      </dl>
    </div>
  )
}

/** Barcodes and SKUs are codes; "sewing mach" is a search. */
function isCode(text: string) {
  const value = text.trim()
  return value.length > 0 && !value.includes(" ") && /^[\w\-./:]+$/.test(value) && /\d/.test(value)
}

function Suggestions({
  query,
  rows,
  loading,
  onPick,
}: {
  query: string
  rows: ProductLookup[]
  loading: boolean
  onPick: (product: ProductLookup) => void
}) {
  if (loading && rows.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Searching for “{query.trim()}”…
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-card/40 p-5 text-sm text-muted-foreground">
        No product matches “{query.trim()}”. Check the spelling, or scan the label.
      </p>
    )
  }
  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {rows.slice(0, 8).map((product) => (
        <li key={product.id}>
          <button
            type="button"
            onClick={() => onPick(product)}
            className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent/60"
          >
            <span>
              <span className="font-medium">{product.name}</span>
              <span className="block font-mono text-xs text-muted-foreground">{product.sku}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** One scanned product: what it is, how many are on the shelf, and the two things to do with it. */
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
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{product.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-mono text-xs">
              {product.sku}
            </Badge>
            {product.category && <span>{product.category}</span>}
            {!product.rentable && <Badge variant="secondary">Not for rent</Badge>}
          </div>
          {product.rentable && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
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
              {product.deposit > 0 && (
                <span className="text-muted-foreground">Deposit {money(product.deposit, currency)} each</span>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[1.75rem] leading-tight font-semibold tabular-nums">{count(onHand)}</div>
          <div className="text-xs text-muted-foreground">on the shelf</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-4">
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
        {onHand === 0 && product.rentable && (
          <p className="text-sm text-warning-soft-foreground dark:text-warning">
            None on the shelf — they may all be out on rent.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  href,
  bad,
}: {
  label: string
  value: string
  hint?: string
  href?: string
  bad?: boolean
}) {
  const body = (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={bad ? "mt-0.5 font-medium tabular-nums text-destructive" : "mt-0.5 font-medium tabular-nums"}>
        {value}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
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
