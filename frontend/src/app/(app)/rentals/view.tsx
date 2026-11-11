"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Package, ReceiptText, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ButtonLink } from "@/components/ui/button-link"
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { Code, DataView, Primary, type Column } from "@/components/data-view"
import { useCurrency } from "@/components/session"
import { useDebounced, usePaging, useRentals } from "@/lib/data/queries"
import { count, date, dueLabel, money, plural } from "@/lib/format"
import type { Rental, RentalStatus } from "@/lib/types"

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

  const columns: Column<Rental>[] = [
    {
      id: "customer",
      header: "Customer",
      role: "title",
      cell: (rental) => (
        <Primary sub={<Code>{rental.code}</Code>}>
          {rental.customerName}
          {rental.customerPhone && (
            <span className="ml-2 font-normal text-muted-foreground max-md:hidden">{rental.customerPhone}</span>
          )}
        </Primary>
      ),
    },
    {
      id: "status",
      header: "Status",
      role: "status",
      cell: (rental) => <StatusBadge status={rental.status} overdue={rental.isOverdue} />,
    },
    {
      id: "out",
      header: "Out",
      align: "end",
      cell: (rental) => (
        <>
          {count(rental.unitsOut)}
          <span className="ml-1 text-xs text-muted-foreground">{plural(rental.itemCount, "item")}</span>
        </>
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (rental) => (
        <span className={rental.isOverdue ? "font-medium text-destructive" : undefined}>
          {rental.dueAt ? dueLabel(rental.dueAt) : "Open-ended"}
        </span>
      ),
    },
    {
      id: "balance",
      header: "Owed",
      align: "end",
      cell: (rental) =>
        rental.balance > 0 ? (
          <span className="text-warning-soft-foreground dark:text-warning">{money(rental.balance, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "started", header: "Started", role: "hidden", cell: (rental) => date(rental.startedAt) },
  ]

  return (
    <div className="space-y-5">
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

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder="Customer, phone number or product"
          label="Search rentals"
          suggest="rentals"
        />
        <FilterTabs value={status} onChange={setStatus} options={FILTERS} label="Filter rentals" />
      </Toolbar>

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
          action={<ButtonLink href="/rent-out">Rent something out</ButtonLink>}
        />
      ) : (
        <>
          <DataView
            label="Rentals"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(rental) => rental.id}
            href={(rental) => `/rentals/${rental.id}`}
            actions={(rental) => (
              <ButtonLink href={`/rentals/${rental.id}/receipt`} variant="outline" size="sm">
                <ReceiptText className="size-4" />
                <span className="md:sr-only">Receipt</span>
              </ButtonLink>
            )}
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
    </div>
  )
}

/** One rental's state, in the three colours that mean something: late, out, done. */
export function StatusBadge({ status, overdue }: { status: RentalStatus; overdue?: boolean }) {
  if (overdue && (status === "active" || status === "partly_returned")) {
    return <Badge variant="destructive">Overdue</Badge>
  }
  if (status === "active") return <Badge variant="info">Out</Badge>
  if (status === "partly_returned") return <Badge variant="warning">Partly back</Badge>
  if (status === "returned") return <Badge variant="success">Returned</Badge>
  return <Badge variant="outline">Cancelled</Badge>
}
