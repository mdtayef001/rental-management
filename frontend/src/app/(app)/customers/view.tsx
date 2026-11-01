"use client"

import { useState } from "react"
import { Plus, UserX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { DataView, Primary, type Column } from "@/components/data-view"
import { CustomerDialog } from "@/components/customer-picker"
import { useCurrency } from "@/components/session"
import { useCustomers, useDebounced, usePaging } from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import type { Customer } from "@/lib/types"

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Has items out" },
  { value: "blocked", label: "Blocked" },
] as const

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

  const columns: Column<Customer>[] = [
    {
      id: "name",
      header: "Name",
      role: "title",
      cell: (customer) => <Primary sub={customer.company || customer.phone}>{customer.name}</Primary>,
    },
    {
      id: "blocked",
      header: "",
      role: "status",
      cell: (customer) =>
        customer.blocked ? (
          <Badge variant="destructive" className="gap-1">
            <UserX className="size-3" />
            Blocked
          </Badge>
        ) : null,
    },
    {
      id: "phone",
      header: "Phone",
      role: "hidden",
      cell: (customer) => <span className="font-mono text-xs">{customer.phone || "—"}</span>,
    },
    {
      id: "out",
      header: "Out now",
      align: "end",
      cell: (customer) =>
        customer.openRentalCount ? (
          <Badge variant="info">{count(customer.openRentalCount)}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "rentals",
      header: "Rentals",
      align: "end",
      cell: (customer) => <span className="text-muted-foreground">{count(customer.rentalCount ?? 0)}</span>,
    },
    {
      id: "owes",
      header: "Owes",
      align: "end",
      cell: (customer) =>
        (customer.balanceDue ?? 0) > 0 ? (
          <span className="text-warning-soft-foreground dark:text-warning">{money(customer.balanceDue, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Everyone you rent to, and what they have out.">
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New customer
        </Button>
      </PageHeader>

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder="Name, phone number, company or ID"
          label="Search customers"
        />
        <FilterTabs value={filter} onChange={setFilter} options={FILTERS} label="Filter customers" />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nobody matches “${search}”` : "No customers yet"}
          description={
            search ? "Try a different name or number." : "Add a customer, or add one while renting something out."
          }
          action={<Button onClick={() => setAdding(true)}>Add a customer</Button>}
        />
      ) : (
        <>
          <DataView
            label="Customers"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(customer) => customer.id}
            href={(customer) => `/customers/${customer.id}`}
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

      <CustomerDialog open={adding} onOpenChange={setAdding} onSaved={() => setAdding(false)} />
    </div>
  )
}
