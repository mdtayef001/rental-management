"use client"

import { useState } from "react"
import { FileText, MessageCircle, Pencil, Phone, ReceiptText, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { Code, DataView, Primary } from "@/components/data-view"
import { CustomerDialog } from "@/components/customer-picker"
import { CustomerPrices } from "@/components/customer-prices"
import { useCurrency, useCurrentUser } from "@/components/session"
import { useCustomer, usePaging, useRentals } from "@/lib/data/queries"
import { count, date, dueLabel, money, plural, whatsappLink } from "@/lib/format"
import { StatusBadge } from "../../rentals/view"

/**
 * One customer: their details, what they have out, and everything they have ever rented.
 *
 * Every time they rent is its own rental with its own number and its own receipt, however
 * many they have running at once. The list shows each one with what it has been charged
 * and what is still owed on it, and a Receipt button to print or send that one alone. The
 * Bill button at the top is the other view: all of them together on one sheet for a month.
 */
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
        {user.role !== "staff" && (
          <ButtonLink href={`/bills/${id}`} variant="outline">
            <FileText className="size-4" />
            Monthly bill
          </ButtonLink>
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

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rentals and receipts</CardTitle>
            <p className="text-sm text-muted-foreground">Each rental has its own receipt. Newest first.</p>
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
                    {
                      id: "units",
                      header: "Still out",
                      align: "end",
                      cell: (rental) =>
                        rental.unitsOut > 0 ? (
                          <>
                            {count(rental.unitsOut)}
                            {rental.dueAt && (
                              <div className={`text-xs ${rental.isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                                {dueLabel(rental.dueAt)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                    {
                      id: "charged",
                      header: "Charged",
                      align: "end",
                      cell: (rental) =>
                        rental.charges > 0 ? (
                          money(rental.charges, currency)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                    {
                      id: "owed",
                      header: "Owed",
                      align: "end",
                      cell: (rental) =>
                        rental.balance > 0 ? (
                          <span className="font-medium">{money(rental.balance, currency)}</span>
                        ) : rental.balance < 0 ? (
                          <span className="text-muted-foreground">{money(-rental.balance, currency)} ahead</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                  ]}
                  actions={(rental) => (
                    <ButtonLink href={`/rentals/${rental.id}/receipt`} variant="outline" size="sm">
                      <ReceiptText className="size-4" />
                      Receipt
                    </ButtonLink>
                  )}
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
              {(customer.balanceDue ?? 0) < 0 ? (
                // More paid than charged so far: an advance waiting for the rent.
                <Row label="Paid ahead" value={money(-(customer.balanceDue ?? 0), currency)} />
              ) : (
                <Row
                  label="Still owes"
                  value={money(customer.balanceDue ?? 0, currency)}
                  warn={(customer.balanceDue ?? 0) > 0}
                />
              )}
            </CardContent>
          </Card>

          <CustomerPrices customerId={id} customerName={customer.name} canEdit={user.role !== "staff"} />

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
