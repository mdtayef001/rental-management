"use client"

import { useState } from "react"
import { MessageCircle, Pencil, Phone, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { Code, DataView, Primary } from "@/components/data-view"
import { CustomerDialog } from "@/components/customer-picker"
import { useCurrency, useCurrentUser } from "@/components/session"
import { useCustomer, usePaging, useRentals } from "@/lib/data/queries"
import { count, date, dueLabel, money, plural, whatsappLink } from "@/lib/format"
import { StatusBadge } from "../../rentals/view"

/** One customer: their details, what they have out, and everything they have ever rented. */
export function CustomerDetailView({ id }: { id: string }) {
  const currency = useCurrency()
  const user = useCurrentUser()
  const [editing, setEditing] = useState(false)
  const { data: customer, isLoading, isError, error, refetch } = useCustomer(id)
  const { page, pageSize, setPage, setPageSize } = usePaging(id)
  const rentals = useRentals({ page, customer: id }, { pageSize })

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !customer) return <TableSkeleton rows={5} columns={4} />

  const share = whatsappLink(customer.phone, `Hello ${customer.name},`)

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={customer.company || undefined}
        back={{ href: "/customers", label: "Customers" }}
      >
        {customer.phone && (
          <Button variant="outline" render={<a href={`tel:${customer.phone}`} />}>
            <Phone className="size-4" />
            {customer.phone}
          </Button>
        )}
        {share && (
          <Button variant="outline" render={<a href={share} target="_blank" rel="noreferrer" />}>
            <MessageCircle className="size-4" />
            WhatsApp
          </Button>
        )}
        {user.role !== "staff" && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        )}
        <ButtonLink href="/rent-out">Rent to them</ButtonLink>
      </PageHeader>

      {customer.blocked && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-3 text-sm">
          <UserX className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <strong>Blocked from renting.</strong> {customer.blockedReason || "No reason given."}
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rentals</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rentals.isLoading ? (
              <div className="p-4">
                <TableSkeleton rows={3} columns={4} />
              </div>
            ) : rentals.data?.results.length === 0 ? (
              <EmptyState title="Nothing rented yet" description="This customer has no rental history." />
            ) : (
              <div className="px-3 pb-3 md:px-0 md:pb-0">
                <DataView
                  label={`Rentals by ${customer.name}`}
                  className="md:rounded-none md:border-0"
                  rows={rentals.data?.results ?? []}
                  getKey={(rental) => rental.id}
                  href={(rental) => `/rentals/${rental.id}`}
                  columns={[
                    {
                      id: "rental",
                      header: "Rental",
                      role: "title",
                      cell: (rental) => (
                        <Primary sub={<Code>{rental.code}</Code>}>{date(rental.startedAt)}</Primary>
                      ),
                    },
                    {
                      id: "status",
                      header: "Status",
                      role: "status",
                      cell: (rental) => <StatusBadge status={rental.status} overdue={rental.isOverdue} />,
                    },
                    { id: "units", header: "Units", align: "end", cell: (rental) => count(rental.unitsOut) },
                    {
                      id: "due",
                      header: "Due",
                      cell: (rental) => (
                        <span className={rental.isOverdue ? "text-destructive" : undefined}>
                          {rental.dueAt ? dueLabel(rental.dueAt) : "Open-ended"}
                        </span>
                      ),
                    },
                    {
                      id: "owed",
                      header: "Owed",
                      align: "end",
                      cell: (rental) =>
                        rental.balance > 0 ? (
                          money(rental.balance, currency)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                  ]}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Rentals in total" value={count(customer.rentalCount ?? 0)} />
              <Row label="Out right now" value={plural(customer.openRentalCount ?? 0, "rental")} />
              <Row
                label="Still owes"
                value={money(customer.balanceDue ?? 0, currency)}
                warn={(customer.balanceDue ?? 0) > 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {customer.phone && <Row label="Phone" value={customer.phone} />}
              {customer.email && <Row label="Email" value={customer.email} />}
              {customer.address && <Row label="Address" value={customer.address} />}
              {customer.idNumber && <Row label={customer.idType || "ID"} value={customer.idNumber} />}
              <Row label="Added" value={date(customer.createdAt)} />
              {customer.notes && (
                <div className="border-t pt-2">
                  <div className="text-muted-foreground">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap">{customer.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {rentals.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={rentals.data.count}
          onPage={setPage}
          onPageSize={setPageSize}
          busy={rentals.isFetching}
        />
      )}

      <CustomerDialog open={editing} onOpenChange={setEditing} customer={customer} onSaved={() => setEditing(false)} />
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`shrink-0 text-right ${warn ? "font-medium text-warning-soft-foreground dark:text-warning" : ""}`}>
        {value}
      </span>
    </div>
  )
}
