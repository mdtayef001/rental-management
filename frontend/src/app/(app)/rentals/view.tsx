"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Package, Search, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { useCurrency } from "@/components/session"
import { useDebounced, usePaging, useRentals } from "@/lib/data/queries"
import { count, date, dueLabel, money, plural } from "@/lib/format"
import type { RentalStatus } from "@/lib/types"

const FILTERS = [
  { value: "open", label: "Out now" },
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due today" },
  { value: "unpaid", label: "Unpaid" },
  { value: "returned", label: "Returned" },
  { value: "", label: "All" },
] as const

/**
 * The rentals list.
 *
 * Filtering, searching and paging all happen in the database — the browser never receives
 * more than one page — so this screen is as quick on a shop with 50,000 rentals as on a new
 * one.
 */
export function RentalsView() {
  const currency = useCurrency()
  const params = useSearchParams()
  const [status, setStatus] = useState<string>(params.get("status") ?? "open")
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(status, search)

  const { data, isLoading, isFetching, isError, error, refetch } = useRentals(
    { page, status, search, sort: status === "overdue" ? "due" : undefined },
    { pageSize },
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Rentals" description="Everything that has gone out, and what has come back.">
        <ButtonLink href="/take-back" variant="outline">
            <Undo2 className="size-4" />
            Take back
          </ButtonLink>
        <ButtonLink href="/rent-out">
            <Package className="size-4" />
            Rent out
          </ButtonLink>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Customer, phone number or product"
            className="pl-9"
            aria-label="Search rentals"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={status === filter.value ? "default" : "outline"}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "No rentals here"}
          description={
            search
              ? "Try a different name, phone number or product."
              : status === "open"
                ? "Nothing is out on rent at the moment."
                : "Nothing matches this filter."
          }
          action={
            <ButtonLink href="/rent-out">Rent something out</ButtonLink>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rental</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((rental) => (
                  <TableRow key={rental.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/rentals/${rental.id}`} className="hover:underline">
                        {rental.code}
                      </Link>
                      <div className="mt-0.5 font-sans text-xs text-muted-foreground">{date(rental.startedAt)}</div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/rentals/${rental.id}`} className="font-medium hover:underline">
                        {rental.customerName}
                      </Link>
                      {rental.customerPhone && (
                        <div className="text-xs text-muted-foreground">{rental.customerPhone}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(rental.unitsOut)}
                      <div className="text-xs text-muted-foreground">{plural(rental.itemCount, "item")}</div>
                    </TableCell>
                    <TableCell>
                      <span className={rental.isOverdue ? "text-destructive" : undefined}>
                        {rental.dueAt ? dueLabel(rental.dueAt) : "Open-ended"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rental.balance > 0 ? money(rental.balance, currency) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={rental.status} overdue={rental.isOverdue} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

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
    </div>
  )
}

export function StatusBadge({ status, overdue }: { status: RentalStatus; overdue?: boolean }) {
  if (overdue && (status === "active" || status === "partly_returned")) {
    return <Badge variant="destructive">Overdue</Badge>
  }
  if (status === "active") return <Badge variant="secondary">Out</Badge>
  if (status === "partly_returned") return <Badge variant="outline">Partly back</Badge>
  if (status === "returned") return <Badge variant="outline">Returned</Badge>
  return <Badge variant="outline">Cancelled</Badge>
}
