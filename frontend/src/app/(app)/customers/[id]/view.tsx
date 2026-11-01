"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, MessageCircle, Pencil, Phone, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
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
      <Button variant="ghost" size="sm" render={<Link href="/customers" />}>
        <ArrowLeft className="size-4" />
        Customers
      </Button>

      <PageHeader title={customer.name} description={customer.company || undefined}>
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
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rental</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rentals.data?.results.map((rental) => (
                      <TableRow key={rental.id}>
                        <TableCell>
                          <Link href={`/rentals/${rental.id}`} className="font-mono text-xs hover:underline">
                            {rental.code}
                          </Link>
                          <div className="text-xs text-muted-foreground">{date(rental.startedAt)}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{count(rental.unitsOut)}</TableCell>
                        <TableCell className={`text-sm ${rental.isOverdue ? "text-destructive" : ""}`}>
                          {rental.dueAt ? dueLabel(rental.dueAt) : "Open-ended"}
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
      <span className={`shrink-0 text-right ${warn ? "font-medium text-amber-600 dark:text-amber-500" : ""}`}>
        {value}
      </span>
    </div>
  )
}
