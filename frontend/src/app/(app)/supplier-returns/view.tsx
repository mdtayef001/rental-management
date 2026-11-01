"use client"

import { useState } from "react"
import { PackageX, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
  StatGrid,
  StatTile,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { Code, DataView, Primary, type Column } from "@/components/data-view"
import { useCurrency } from "@/components/session"
import { useCreateSupplierReturn, useSettleSupplierReturn } from "@/lib/data/mutations"
import {
  useDebounced,
  usePaging,
  usePurchases,
  useSupplierReturns,
  useSupplierReturnSummary,
} from "@/lib/data/queries"
import { count, date, money, plural } from "@/lib/format"
import type { Purchase, PurchaseItem, SupplierReturn } from "@/lib/types"

const STATUSES = [
  { value: "", label: "All" },
  { value: "open", label: "Waiting" },
  { value: "settled", label: "Settled" },
  { value: "closed", label: "Written off" },
] as const

/**
 * Faulty stock sent back to the supplier.
 *
 * The question this screen answers is "what is sitting with a supplier, and what do they
 * still owe me for it" — so every row leads with how much is still outstanding, and the
 * default view is the returns nobody has settled yet. Sending stock back takes it off the
 * shelf immediately, which is why it reads as an action with consequences rather than a
 * note someone files.
 */
export function SupplierReturnsView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const [status, setStatus] = useState<string>("open")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, status)
  const [sending, setSending] = useState(false)
  const [settling, setSettling] = useState<SupplierReturn | null>(null)

  const filters = { search, status }
  const { data, isLoading, isFetching, isError, error, refetch } = useSupplierReturns({ page, ...filters }, { pageSize })
  const { data: summary } = useSupplierReturnSummary(filters)

  const columns: Column<SupplierReturn>[] = [
    {
      id: "product",
      header: "Product",
      role: "title",
      cell: (row) => (
        <Primary
          sub={
            <>
              <Code>{row.code}</Code> · bill {row.purchaseCode} · {date(row.createdAt)}
            </>
          }
        >
          {count(row.quantity)} × {row.productName}
        </Primary>
      ),
    },
    {
      id: "status",
      header: "Status",
      role: "status",
      cell: (row) =>
        row.status === "open" ? (
          <Badge variant="warning">Waiting</Badge>
        ) : row.status === "settled" ? (
          <Badge variant="success">Settled</Badge>
        ) : (
          <Badge variant="outline">Written off</Badge>
        ),
    },
    { id: "supplier", header: "Supplier", cell: (row) => row.supplierName || "No supplier" },
    { id: "reason", header: "Reason", role: "hidden", cell: (row) => row.reason },
    { id: "value", header: "Value", align: "end", cell: (row) => money(row.value, currency) },
    {
      id: "settled",
      header: "Settled by",
      cell: (row) => <Settlement row={row} currency={currency} />,
    },
    {
      id: "owed",
      header: "Still owed",
      align: "end",
      cell: (row) =>
        row.outstanding > 0 ? (
          <span className="font-medium text-warning-soft-foreground dark:text-warning">
            {money(row.outstanding, currency)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sent back to supplier"
        description="Faulty stock returned to whoever sold it, and what they still owe you for it."
      >
        <Button onClick={() => setSending(true)}>
          <PackageX className="size-4" />
          Send stock back
        </Button>
      </PageHeader>

      {summary && summary.count > 0 && (
        <StatGrid>
          <StatTile
            label="Waiting on suppliers"
            value={count(summary.open)}
            hint={summary.open ? "Chase these up" : "Nothing outstanding"}
            tone={summary.open ? "warning" : "default"}
          />
          <StatTile
            label="Still owed to you"
            value={money(summary.outstanding, currency)}
            tone={summary.outstanding > 0 ? "warning" : "good"}
          />
          <StatTile label="Units sent back" value={count(summary.units)} />
          <StatTile label="Value sent back" value={money(summary.value, currency)} />
        </StatGrid>
      )}

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder="Product, supplier, reason or a code like SR-000012"
          label="Search returns to suppliers"
        />
        <FilterTabs value={status} onChange={setStatus} options={STATUSES} label="Filter returns to suppliers" />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} columns={6} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={
            search
              ? `Nothing matches “${search}”`
              : status === "open"
                ? "Nothing is waiting with a supplier"
                : "Nothing has been sent back"
          }
          description="When stock arrives faulty, send it back here: it comes off the shelf and the supplier owes you for it."
          action={<Button onClick={() => setSending(true)}>Send stock back</Button>}
        />
      ) : (
        <>
          <DataView
            label="Returns to suppliers"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(row) => row.id}
            actions={(row) =>
              row.status === "open" ? (
                <Button size="sm" variant="outline" onClick={() => setSettling(row)}>
                  Settle
                </Button>
              ) : null
            }
          />

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.count ?? 0}
            onPage={setPage}
            onPageSize={setPageSize}
            busy={isFetching}
          />
        </>
      )}

      {sending && <SendBackDialog onClose={() => setSending(false)} />}
      {settling && <SettleDialog row={settling} onClose={() => setSettling(null)} />}
    </div>
  )
}

/** How far a return has been made good: replacements, money back, or money off the next bill. */
function Settlement({ row, currency }: { row: SupplierReturn; currency: string }) {
  const parts = [
    row.replacedQuantity > 0 && `${count(row.replacedQuantity)} replaced`,
    row.refundedAmount > 0 && `${money(row.refundedAmount, currency)} refunded`,
    row.creditedAmount > 0 && `${money(row.creditedAmount, currency)} credited`,
  ].filter(Boolean) as string[]

  if (parts.length === 0) {
    return <span>{row.status === "closed" ? row.closedNote || "Written off" : "Nothing yet"}</span>
  }
  return (
    <span>
      {parts.join(" · ")}
      {row.status === "closed" && row.closedNote && <span className="block">Rest written off: {row.closedNote}</span>}
    </span>
  )
}

/**
 * Sending stock back.
 *
 * A return belongs to the bill it was bought on, because that bill is what says who to
 * chase and what was paid per unit. So the first step is finding that bill, and the quantity
 * is capped at what is still left on the line — you can't send back more than you bought.
 */
function SendBackDialog({ onClose }: { onClose: () => void }) {
  const currency = useCurrency()
  const create = useCreateSupplierReturn()
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 300)
  const [bill, setBill] = useState<Purchase | null>(null)
  const [item, setItem] = useState<PurchaseItem | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState("")

  const bills = usePurchases({ page: 1, search }, { pageSize: 20, enabled: !bill })
  const max = item?.quantityReturnable ?? 0
  const ready = !!item && quantity >= 1 && quantity <= max && reason.trim().length > 0

  function choose(chosen: Purchase) {
    setBill(chosen)
    const returnable = chosen.items.filter((line) => line.quantityReturnable > 0)
    // One line with anything left on it is the common case, so don't make them pick it.
    if (returnable.length === 1) setItem(returnable[0])
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send stock back</DialogTitle>
          <DialogDescription>
            This takes the units off the shelf now, and records that the supplier owes you for them.
          </DialogDescription>
        </DialogHeader>

        {!bill ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sr-bill">Which bill did it come in on?</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="sr-bill"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Supplier, invoice number or product"
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>
            {bills.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Loading bills…
              </p>
            ) : bills.data && bills.data.results.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No bill matches that. Only stock recorded as a purchase can be sent back.
              </p>
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {bills.data?.results.map((purchase) => {
                  const left = purchase.items.reduce((n, line) => n + line.quantityReturnable, 0)
                  return (
                    <li key={purchase.id}>
                      <button
                        type="button"
                        disabled={left === 0}
                        onClick={() => choose(purchase)}
                        className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-accent/60 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{purchase.supplierName || "No supplier"}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            <span className="font-mono">{purchase.code}</span> · {date(purchase.purchasedAt)}
                            {purchase.reference && ` · their ref ${purchase.reference}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {left === 0 ? "All sent back" : `${count(left)} left`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-3 text-sm">
              <span>
                <span className="font-medium">{bill.supplierName || "No supplier"}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{bill.code}</span> · {date(bill.purchasedAt)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBill(null)
                  setItem(null)
                }}
              >
                Change bill
              </Button>
            </div>

            <div className="space-y-2">
              <Label>What is going back?</Label>
              <div className="space-y-2">
                {bill.items.map((line) => (
                  <button
                    key={line.id}
                    type="button"
                    disabled={line.quantityReturnable === 0}
                    onClick={() => {
                      setItem(line)
                      setQuantity(Math.min(quantity, line.quantityReturnable))
                    }}
                    aria-pressed={item?.id === line.id}
                    className={
                      "flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left text-sm disabled:opacity-50 " +
                      (item?.id === line.id ? "border-primary bg-accent/60" : "hover:bg-accent/40")
                    }
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{line.productName}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {money(line.unitCost, currency)} each · bought {count(line.quantity)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {line.quantityReturnable === 0 ? "All sent back" : `${count(line.quantityReturnable)} can go back`}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="sr-qty">How many</Label>
                <Input
                  id="sr-qty"
                  type="number"
                  min={1}
                  max={max || 1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  className="tabular-nums"
                  disabled={!item}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sr-reason">What&rsquo;s wrong with it?</Label>
                <Input
                  id="sr-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  placeholder="Faulty motors"
                  disabled={!item}
                />
              </div>
            </div>

            {item && quantity > max && (
              <p className="text-sm text-warning-soft-foreground dark:text-warning">
                Only {count(max)} of those are left on this bill to send back.
              </p>
            )}
            {item && (
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">The supplier will owe you</span>
                <span className="text-lg font-semibold tabular-nums">
                  {money(Math.min(quantity, max) * item.unitCost, currency)}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || create.isPending}
            onClick={() =>
              item &&
              create.mutate(
                { item: item.id, quantity, reason: reason.trim() },
                { onSuccess: onClose },
              )
            }
          >
            {create.isPending && <Spinner />}
            {item ? `Send back ${plural(Math.min(quantity, max), "unit")}` : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Settling a return.
 *
 * A supplier makes it good in one of three ways, and often in more than one: replacements
 * come back as stock, a refund is money in, and a credit comes off what you already owe
 * them. Each can be recorded on its own, so a return that's half replaced stays open for
 * the rest. The last resort is at the bottom, deliberately quiet: close it and take the loss.
 */
function SettleDialog({ row, onClose }: { row: SupplierReturn; onClose: () => void }) {
  const currency = useCurrency()
  const settle = useSettleSupplierReturn()
  const [replaced, setReplaced] = useState<number | "">("")
  const [refunded, setRefunded] = useState<number | "">("")
  const [credited, setCredited] = useState<number | "">("")
  const [note, setNote] = useState("")

  const units = Math.min(Number(replaced) || 0, row.unitsToReplace)
  const cashBack = (Number(refunded) || 0) + (Number(credited) || 0)
  // What's left after what's being recorded now, so the number moves as they type.
  const left = Math.max(row.outstanding - units * row.unitCost - cashBack, 0)
  const over = units * row.unitCost + cashBack > row.outstanding
  const something = units > 0 || cashBack > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settle {row.code}</DialogTitle>
          <DialogDescription>
            {count(row.quantity)} × {row.productName} went back to {row.supplierName || "no supplier"} —{" "}
            {money(row.outstanding, currency)} of it is still owed to you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="st-replaced">Units replaced</Label>
              <Input
                id="st-replaced"
                type="number"
                min={0}
                max={row.unitsToReplace}
                value={replaced}
                onChange={(e) => setReplaced(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                className="tabular-nums"
                placeholder="0"
                disabled={row.unitsToReplace === 0}
              />
              <p className="text-xs text-muted-foreground">
                {row.unitsToReplace === 0 ? "No more can be replaced" : `Up to ${count(row.unitsToReplace)}, back on the shelf`}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-refunded">Refunded</Label>
              <Input
                id="st-refunded"
                type="number"
                min={0}
                step="0.01"
                value={refunded}
                onChange={(e) => setRefunded(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                className="tabular-nums"
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">Money they gave back</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-credited">Credited</Label>
              <Input
                id="st-credited"
                type="number"
                min={0}
                step="0.01"
                value={credited}
                onChange={(e) => setCredited(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                className="tabular-nums"
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">Taken off what you owe them</p>
            </div>
          </div>

          {over ? (
            <p className="text-sm text-destructive">
              That&rsquo;s more than the {money(row.outstanding, currency)} still outstanding on this return.
            </p>
          ) : (
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Still owed after this</span>
              <span className="text-lg font-semibold tabular-nums">{money(left, currency)}</span>
            </div>
          )}

          <div className="space-y-2 rounded-md border border-dashed p-3">
            <Label htmlFor="st-note">Not getting anything back?</Label>
            <Input
              id="st-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="Supplier wouldn't accept the claim"
            />
            <p className="text-xs text-muted-foreground">
              Closing it writes off the {money(row.outstanding, currency)} still owed and shows up in your reports as a
              loss. Record any replacements or money first.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={settle.isPending || !note.trim() || something}
              onClick={() => settle.mutate({ id: row.id, closeNote: note.trim() }, { onSuccess: onClose })}
            >
              Close as a loss
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={settle.isPending || !something || over}
            onClick={() =>
              settle.mutate(
                {
                  id: row.id,
                  replacedQuantity: units,
                  refundedAmount: Number(refunded) || 0,
                  creditedAmount: Number(credited) || 0,
                },
                { onSuccess: onClose },
              )
            }
          >
            {settle.isPending && <Spinner />}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
