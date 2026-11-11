"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  StatCard,
  StatGrid,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { DataView, Primary, type Column } from "@/components/data-view"
import { PeriodPicker, PrintBill } from "@/components/bill"
import { useCurrency } from "@/components/session"
import { rangeFromParams, rangeQuery } from "@/lib/bills"
import { billPdfUrl, useBills, useDebounced, usePaging } from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import type { BillRow, ReportRange } from "@/lib/types"

/**
 * The period lives in the address bar, so a bill's link can be sent to a colleague and
 * the Back button returns to the month that was being worked through.
 */
export function usePeriod() {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const range = rangeFromParams(params)
  const setRange = (next: ReportRange) => router.replace(`${path}?${rangeQuery(next)}`, { scroll: false })
  return [range, setRange] as const
}

/**
 * Month end, on one screen.
 *
 * Everyone who had something out or paid something in the period, largest bill first,
 * each one a tap away from its printable sheet. A customer with nothing to bill isn't
 * listed: the list is the work to do, not the address book.
 */
export function BillsView() {
  const currency = useCurrency()
  const [range, setRange] = usePeriod()
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, range.from, range.to)
  const { data, isLoading, isFetching, isError, error, refetch } = useBills(range, { page, search, pageSize })
  // The customer whose bill is being sent to the printer straight from the list.
  const [printing, setPrinting] = useState<string | null>(null)

  const columns: Column<BillRow>[] = [
    {
      id: "customer",
      header: "Customer",
      role: "title",
      cell: (row) => <Primary sub={row.company || row.phone || undefined}>{row.customerName}</Primary>,
    },
    { id: "rentals", header: "Rentals", align: "end", cell: (row) => count(row.rentals) },
    { id: "out", header: "Still out", align: "end", cell: (row) => count(row.unitsOut) },
    {
      id: "paid",
      header: "Paid",
      align: "end",
      cell: (row) => (row.paid ? money(row.paid, currency) : <span className="text-muted-foreground">—</span>),
    },
    {
      id: "charges",
      header: "Billed",
      align: "end",
      cell: (row) => <span className="font-medium">{money(row.charges, currency)}</span>,
    },
  ]

  return (
    <>
    {/* Off screen until it prints. The list itself stays off the paper, so a bill printed
        from here is the bill and nothing after it. */}
    {printing && <PrintBill customerId={printing} range={range} onDone={() => setPrinting(null)} />}
    <div className="space-y-6 print:hidden">
      <div className="space-y-4">
        <PageHeader
          title="Bills"
          description="What each customer owes for a month or a year. Print a bill or save it as a PDF from here, or open it to take a payment."
        />
        <PeriodPicker range={range} onChange={setRange} />
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Billed" value={money(data?.totals.charges ?? 0, currency)} loading={!data} hint={data?.label} />
            <StatCard label="Paid in the period" value={money(data?.totals.paid ?? 0, currency)} loading={!data} />
            <StatCard label="Customers to bill" value={count(data?.totals.customers ?? 0)} loading={!data} />
            <StatCard label="Units still out" value={count(data?.totals.unitsOut ?? 0)} loading={!data} />
          </StatGrid>

          <Toolbar>
            <SearchInput value={text} onChange={setText} label="Search bills" placeholder="Search by name, company or phone" suggest="customer-names" />
          </Toolbar>

          {isLoading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : data?.results.length === 0 ? (
            <EmptyState
              title={search ? "No bills match" : "Nothing to bill"}
              description={
                search
                  ? "Try a different name, or clear the search."
                  : "No customer had anything out on rent, or paid anything, in this period."
              }
            />
          ) : (
            <DataView
              label="Bills"
              rows={data?.results ?? []}
              columns={columns}
              getKey={(row) => row.customerId}
              href={(row) => `/bills/${row.customerId}?${rangeQuery(range)}`}
              actions={(row) => (
                <div className="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={printing !== null}
                    onClick={() => setPrinting(row.customerId)}
                    aria-label={`Print ${row.customerName}'s bill`}
                  >
                    <Printer className="size-4" />
                    {printing === row.customerId ? "Preparing…" : "Print"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={billPdfUrl(row.customerId, range)} download aria-label={`Download ${row.customerName}'s bill as a PDF`} />}
                  >
                    <Download className="size-4" />
                    PDF
                  </Button>
                </div>
              )}
            />
          )}

          {data && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={data.count}
              onPage={setPage}
              onPageSize={setPageSize}
              busy={isFetching}
            />
          )}
        </>
      )}
    </div>
    </>
  )
}
