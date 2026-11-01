"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Search, UserX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { CustomerDialog } from "@/components/customer-picker"
import { useCurrency } from "@/components/session"
import { useCustomers, useDebounced, usePaging } from "@/lib/data/queries"
import { count, money } from "@/lib/format"

/** Who the business rents to, with what each of them has out and owes. */
export function CustomersView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const [filter, setFilter] = useState<"" | "open" | "blocked">("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, filter)
  const [adding, setAdding] = useState(false)

  const { data, isLoading, isFetching, isError, error, refetch } = useCustomers(
    {
      page,
      search,
      stats: true,
      hasOpenRentals: filter === "open" || undefined,
      blocked: filter === "blocked" || undefined,
    },
    { pageSize },
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Everyone you rent to, and what they have out.">
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New customer
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, phone number, company or ID"
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              { value: "", label: "All" },
              { value: "open", label: "Has items out" },
              { value: "blocked", label: "Blocked" },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nobody matches “${search}”` : "No customers yet"}
          description={search ? "Try a different name or number." : "Add a customer, or add one while renting something out."}
          action={<Button onClick={() => setAdding(true)}>Add a customer</Button>}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Out now</TableHead>
                  <TableHead className="text-right">Rentals</TableHead>
                  <TableHead className="text-right">Owes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link href={`/customers/${customer.id}`} className="font-medium hover:underline">
                        {customer.name}
                      </Link>
                      {customer.company && <div className="text-xs text-muted-foreground">{customer.company}</div>}
                      {customer.blocked && (
                        <Badge variant="destructive" className="mt-1 gap-1">
                          <UserX className="size-3" />
                          Blocked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{customer.phone || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {customer.openRentalCount ? (
                        <Badge variant="secondary">{count(customer.openRentalCount)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {count(customer.rentalCount ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(customer.balanceDue ?? 0) > 0 ? (
                        <span className="text-amber-600 dark:text-amber-500">
                          {money(customer.balanceDue, currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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

      <CustomerDialog open={adding} onOpenChange={setAdding} onSaved={() => setAdding(false)} />
    </div>
  )
}
