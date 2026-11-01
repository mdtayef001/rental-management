"use client"

import { useState } from "react"
import { Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ButtonLink } from "@/components/ui/button-link"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { Code, DataView, Primary, type Column } from "@/components/data-view"
import { useCurrency } from "@/components/session"
import { useDebounced, usePaging, useReturns } from "@/lib/data/queries"
import { count, friendlyDateTime, money, plural } from "@/lib/format"
import type { RentalReturn } from "@/lib/types"

/** Everything that has come back, newest first. The counterpart to the rentals list. */
export function ReturnsView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search)

  const { data, isLoading, isFetching, isError, error, refetch } = useReturns({ page, search }, { pageSize })

  const columns: Column<RentalReturn>[] = [
    {
      id: "customer",
      header: "Customer",
      role: "title",
      cell: (taken) => (
        <Primary
          sub={
            <>
              <Code>{taken.code}</Code> · {friendlyDateTime(taken.at)}
            </>
          }
        >
          {taken.customerName}
        </Primary>
      ),
    },
    {
      id: "condition",
      header: "Condition",
      role: "status",
      cell: (taken) => {
        const bad = taken.lines.filter((line) => line.condition !== "good")
        const units = bad.reduce((n, line) => n + line.quantity, 0)
        return bad.length > 0 ? (
          <Badge variant="destructive">{count(units)} not good</Badge>
        ) : (
          <Badge variant="success">All good</Badge>
        )
      },
    },
    {
      id: "what",
      header: "Came back",
      cell: (taken) => {
        const units = taken.lines.reduce((n, line) => n + line.quantity, 0)
        return `${plural(units, "unit")} over ${plural(taken.lines.length, "line")}`
      },
    },
    {
      id: "charged",
      header: "Charged",
      align: "end",
      cell: (taken) => (
        <>
          {money(taken.charges, currency)}
          {taken.lateFee > 0 && (
            <div className="text-xs text-warning-soft-foreground dark:text-warning">
              inc. {money(taken.lateFee, currency)} late
            </div>
          )}
        </>
      ),
    },
    { id: "paid", header: "Paid", align: "end", cell: (taken) => money(taken.paidAmount, currency) },
    {
      id: "by",
      header: "Taken by",
      role: "hidden",
      cell: (taken) => <span className="text-muted-foreground">{taken.byName || "—"}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Returns" description="Every time items have come back, and what each one charged.">
        <ButtonLink href="/take-back">
          <Undo2 className="size-4" />
          Take back
        </ButtonLink>
      </PageHeader>

      <Toolbar>
        <SearchInput value={text} onChange={setText} placeholder="Customer or product" label="Search returns" />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "Nothing has come back yet"}
          description={search ? "Try a different name." : "Returns will appear here as items come in."}
          icon={Undo2}
        />
      ) : (
        <>
          <DataView
            label="Returns"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(taken) => taken.id}
            href={(taken) => `/rentals/${taken.rentalId}`}
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
