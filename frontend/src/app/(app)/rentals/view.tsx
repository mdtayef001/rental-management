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
import { msg, t } from "@/lib/i18n"

const FILTERS = [
  { value: "open", label: msg("Out now") },
  { value: "overdue", label: msg("Overdue") },
  { value: "due_today", label: msg("Due today") },
  { value: "unpaid", label: msg("Unpaid") },
  { value: "returned", label: msg("Returned") },
  { value: "", label: msg("All") },
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
      header: t("Customer"),
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
      header: t("Status"),
      role: "status",
      cell: (rental) => <StatusBadge status={rental.status} overdue={rental.isOverdue} />,
    },
    {
      id: "out",
      header: t("Out"),
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
      header: t("Due"),
      cell: (rental) => (
        <span className={rental.isOverdue ? "font-medium text-destructive" : undefined}>
          {rental.dueAt ? dueLabel(rental.dueAt) : t("Open-ended")}
        </span>
      ),
    },
    {
      id: "balance",
      header: t("Owed"),
      align: "end",
      cell: (rental) =>
        rental.balance > 0 ? (
          <span className="text-warning-soft-foreground dark:text-warning">{money(rental.balance, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "started", header: t("Started"), role: "hidden", cell: (rental) => date(rental.startedAt) },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title={t("Rentals")} description={t("Everything that has gone out, and what has come back.")}>
        <ButtonLink href="/take-back" variant="outline">
          <Undo2 className="size-4" />
          {t("Take back")}
        </ButtonLink>
        <ButtonLink href="/rent-out">
          <Package className="size-4" />
          {t("Rent out")}
        </ButtonLink>
      </PageHeader>

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder={t("Customer, phone number or product")}
          label={t("Search rentals")}
          suggest="rentals"
        />
        <FilterTabs value={status} onChange={setStatus} options={FILTERS} label={t("Filter rentals")} />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? t("Nothing matches “{search}”", { search }) : t("No rentals here")}
          description={
            search
              ? t("Try a different name, phone number or product.")
              : status === "open"
                ? t("Nothing is out on rent at the moment.")
                : t("Nothing matches this filter.")
          }
          action={<ButtonLink href="/rent-out">{t("Rent something out")}</ButtonLink>}
        />
      ) : (
        <>
          <DataView
            label={t("Rentals")}
            rows={data?.results ?? []}
            columns={columns}
            getKey={(rental) => rental.id}
            href={(rental) => `/rentals/${rental.id}`}
            actions={(rental) => (
              <ButtonLink href={`/rentals/${rental.id}/receipt`} variant="outline" size="sm">
                <ReceiptText className="size-4" />
                <span className="md:sr-only">{t("Receipt")}</span>
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
    return <Badge variant="destructive">{t("Overdue")}</Badge>
  }
  if (status === "active") return <Badge variant="info">{t("Out")}</Badge>
  if (status === "partly_returned") return <Badge variant="warning">{t("Partly back")}</Badge>
  if (status === "returned") return <Badge variant="success">{t("Returned")}</Badge>
  return <Badge variant="outline">{t("Cancelled")}</Badge>
}
