"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ButtonLink } from "@/components/ui/button-link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { useCurrency } from "@/components/session"
import { useDebounced, usePaging, useReturns } from "@/lib/data/queries"
import { count, friendlyDateTime, money, plural } from "@/lib/format"

/** Everything that has come back, newest first. The counterpart to the rentals list. */
export function ReturnsView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search)

  const { data, isLoading, isFetching, isError, error, refetch } = useReturns({ page, search }, { pageSize })

  return (
    <div className="space-y-6">
      <PageHeader title="Returns" description="Every time items have come back, and what each one charged.">
        <ButtonLink href="/take-back">
          <Undo2 className="size-4" />
          Take back
        </ButtonLink>
      </PageHeader>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Customer or product"
          className="pl-9"
          aria-label="Search returns"
        />
      </div>

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
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>What came back</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Taken by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((taken) => {
                  const units = taken.lines.reduce((n, line) => n + line.quantity, 0)
                  const bad = taken.lines.filter((line) => line.condition !== "good")
                  return (
                    <TableRow key={taken.id}>
                      <TableCell>
                        <span className="font-mono text-xs">{taken.code}</span>
                        <div className="text-xs text-muted-foreground">{friendlyDateTime(taken.at)}</div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/rentals/${taken.rentalId}`} className="font-medium hover:underline">
                          {taken.customerName}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">{taken.rentalCode}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {plural(units, "unit")} over {plural(taken.lines.length, "line")}
                        {bad.length > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            {count(bad.reduce((n, line) => n + line.quantity, 0))} not good
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(taken.charges, currency)}
                        {taken.lateFee > 0 && (
                          <div className="text-xs text-amber-600 dark:text-amber-500">
                            inc. {money(taken.lateFee, currency)} late
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(taken.paidAmount, currency)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{taken.byName || "—"}</TableCell>
                    </TableRow>
                  )
                })}
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
