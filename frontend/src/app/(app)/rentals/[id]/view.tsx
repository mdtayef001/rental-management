"use client"

import { useState } from "react"
import { Ban, MessageCircle, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, PageHeader, Spinner, TableSkeleton } from "@/components/common"
import { Code, DataView, Primary } from "@/components/data-view"
import { PrintButton, Receipt } from "@/components/receipt"
import { useCurrency, useCurrentUser, useSession } from "@/components/session"
import { useCancelRental, useRefundDeposit, useRentalPayment } from "@/lib/data/mutations"
import { useRental } from "@/lib/data/queries"
import { count, dateTime, dueLabel, friendlyDateTime, money, plural, whatsappLink } from "@/lib/format"
import { PLAN_LABEL } from "@/lib/rental"
import { StatusBadge } from "../view"

/**
 * One rental in full: what went out, what has come back, and every payment.
 *
 * Returns are started from here as well as from the scanner, because someone looking at a
 * rental on screen shouldn't have to go and scan something to close it.
 */
export function RentalDetailView({ id }: { id: string }) {
  const currency = useCurrency()
  const user = useCurrentUser()
  const { business } = useSession()
  const { data: rental, isLoading, isError, error, refetch } = useRental(id)
  const [paying, setPaying] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !rental) return <TableSkeleton rows={6} columns={4} />

  const held = rental.deposit - rental.depositRefunded
  const share = rental.token
    ? whatsappLink(
        rental.customerPhone,
        `${business?.name ?? "Your rental"} — receipt ${rental.code}: ${window.location.origin}/r/${rental.token}`,
      )
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={rental.code}
        description={`${rental.customerName} · out ${dateTime(rental.startedAt)}`}
        back={{ href: "/rentals", label: "Rentals" }}
      >
        <StatusBadge status={rental.status} overdue={rental.isOverdue} />
        {rental.status !== "cancelled" && rental.status !== "returned" && user.canTakeReturns && (
          <ButtonLink href={`/take-back?rental=${rental.id}`}>
            <Undo2 className="size-4" />
            Take back
          </ButtonLink>
        )}
        <PrintButton />
        {share && (
          <Button variant="outline" render={<a href={share} target="_blank" rel="noreferrer" />}>
            <MessageCircle className="size-4" />
            WhatsApp
          </Button>
        )}
      </PageHeader>

      {rental.isOverdue && (
        <div className="rounded-lg border border-destructive/30 bg-destructive-soft/50 p-3 text-sm">
          <strong>{dueLabel(rental.dueAt)}.</strong> {plural(rental.unitsOut, "unit")} still with{" "}
          {rental.customerName}
          {rental.customerPhone && ` (${rental.customerPhone})`}.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-md:px-3 max-md:pb-3">
              <DataView
                label="Items on this rental"
                className="md:rounded-none md:border-0"
                rows={rental.items ?? []}
                getKey={(item) => item.id}
                columns={[
                  {
                    id: "product",
                    header: "Product",
                    role: "title",
                    cell: (item) => <Primary sub={item.productSku && <Code>{item.productSku}</Code>}>{item.productName}</Primary>,
                  },
                  {
                    id: "still",
                    header: "Still out",
                    role: "status",
                    align: "end",
                    cell: (item) =>
                      item.quantityOut > 0 ? (
                        <Badge variant="info">{count(item.quantityOut)} out</Badge>
                      ) : (
                        <Badge variant="success">All back</Badge>
                      ),
                  },
                  { id: "out", header: "Out", align: "end", cell: (item) => count(item.quantity) },
                  {
                    id: "back",
                    header: "Back",
                    align: "end",
                    cell: (item) => (
                      <>
                        {count(item.quantityReturned)}
                        {item.quantityLost > 0 && (
                          <div className="text-xs text-destructive">{count(item.quantityLost)} lost</div>
                        )}
                      </>
                    ),
                  },
                  {
                    id: "plan",
                    header: "Plan",
                    cell: (item) => (
                      <>
                        {PLAN_LABEL[item.plan]}
                        <div className="text-xs text-muted-foreground">{money(item.rate, currency)}</div>
                      </>
                    ),
                  },
                  {
                    id: "charged",
                    header: "Charged",
                    align: "end",
                    cell: (item) => money(item.lineTotal, currency),
                  },
                ]}
              />
            </CardContent>
          </Card>

          {(rental.returns?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Returns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {rental.returns?.map((taken) => (
                  <div key={taken.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {taken.code}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{friendlyDateTime(taken.at)}</span>
                      </div>
                      <span className="font-medium tabular-nums">{money(taken.charges, currency)}</span>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {taken.lines.map((line) => (
                        <li key={line.id} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">
                            {count(line.quantity)} × {line.productName}
                            {line.condition !== "good" && (
                              <Badge variant="destructive" className="ml-2">
                                {line.condition === "lost" ? "Not returned" : "Damaged"}
                              </Badge>
                            )}
                            <span className="ml-2 text-xs">({plural(line.daysOut, "day")})</span>
                          </span>
                          <span className="tabular-nums">{money(line.total, currency)}</span>
                        </li>
                      ))}
                    </ul>
                    {taken.byName && <div className="mt-2 text-xs text-muted-foreground">Taken by {taken.byName}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(rental.payments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payments</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {rental.payments?.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-sm">{friendlyDateTime(payment.at)}</TableCell>
                        <TableCell className="text-sm capitalize">{payment.kind.replace("_", " ")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{payment.method}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(payment.amount, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {rental.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap">{rental.notes}</CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Line label="Rent charged" value={money(rental.rentTotal, currency)} />
              {rental.lateFee > 0 && <Line label="Late fee" value={money(rental.lateFee, currency)} warn />}
              {rental.damageFee > 0 && <Line label="Damage" value={money(rental.damageFee, currency)} warn />}
              {rental.discount > 0 && <Line label="Discount" value={`− ${money(rental.discount, currency)}`} />}
              <Line label="Paid" value={money(rental.paidAmount, currency)} />
              <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
                <span>{rental.balance >= 0 ? "Balance due" : "To refund"}</span>
                <span className="tabular-nums">{money(Math.abs(rental.balance), currency)}</span>
              </div>

              {rental.deposit > 0 && (
                <div className="space-y-1 border-t pt-2">
                  <Line label="Deposit taken" value={money(rental.deposit, currency)} />
                  {rental.depositRefunded > 0 && (
                    <Line label="Given back" value={money(rental.depositRefunded, currency)} />
                  )}
                  <Line label="Still held" value={money(held, currency)} />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {rental.balance > 0 && (
                  <Button size="sm" onClick={() => setPaying(true)}>
                    <Wallet className="size-4" />
                    Take payment
                  </Button>
                )}
                {held > 0 && user.canHandleDeposits && (
                  <Button size="sm" variant="outline" onClick={() => setRefunding(true)}>
                    Return deposit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Line label="Customer" value={rental.customerName} />
              {rental.customerPhone && <Line label="Phone" value={rental.customerPhone} />}
              {rental.branchName && <Line label="Branch" value={rental.branchName} />}
              <Line label="Out" value={dateTime(rental.startedAt)} />
              <Line label="Due" value={rental.dueAt ? dateTime(rental.dueAt) : "Open-ended"} />
              {rental.returnedAt && <Line label="All back" value={dateTime(rental.returnedAt)} />}
              {rental.createdByName && <Line label="Rented out by" value={rental.createdByName} />}
            </CardContent>
          </Card>

          {user.role !== "staff" && rental.status !== "cancelled" && (rental.returns?.length ?? 0) === 0 && (
            <Button variant="destructive" className="w-full" onClick={() => setCancelling(true)}>
              <Ban className="size-4" />
              Cancel this rental
            </Button>
          )}
        </div>
      </div>

      {/* Hidden on screen, printed by the Print button. */}
      <div className="hidden">
        <Receipt rental={rental} business={business} branchName={rental.branchName} />
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} rental={rental} />
      <DepositDialog open={refunding} onOpenChange={setRefunding} rental={rental} held={held} />
      <CancelDialog open={cancelling} onOpenChange={setCancelling} rentalId={rental.id} code={rental.code} />
    </div>
  )
}

function Line({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={warn ? "text-warning-soft-foreground dark:text-warning" : "text-muted-foreground"}>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

function PaymentDialog({
  open,
  onOpenChange,
  rental,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rental: { id: string; balance: number }
}) {
  const currency = useCurrency()
  const pay = useRentalPayment()
  const [amount, setAmount] = useState<number | "">(rental.balance > 0 ? rental.balance : "")
  const [method, setMethod] = useState("cash")
  const [reference, setReference] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Take a payment</DialogTitle>
          <DialogDescription>{money(rental.balance, currency)} is outstanding.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-amount">Amount</Label>
            <Input
              id="p-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
              className="tabular-nums"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-method">How</Label>
            <select
              id="p-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 w-full rounded-md border bg-card px-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="mobile">Mobile banking</option>
              <option value="card">Card</option>
              <option value="bank">Bank transfer</option>
            </select>
          </div>
          {method === "mobile" && (
            <div className="space-y-1.5">
              <Label htmlFor="p-ref">Transaction ID</Label>
              <Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pay.isPending || !amount}
            onClick={() =>
              pay.mutate(
                { rentalId: rental.id, amount: Number(amount), method, reference },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {pay.isPending && <Spinner />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepositDialog({
  open,
  onOpenChange,
  rental,
  held,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rental: { id: string }
  held: number
}) {
  const currency = useCurrency()
  const refund = useRefundDeposit()
  const [amount, setAmount] = useState<number | "">(held)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Return the deposit</DialogTitle>
          <DialogDescription>{money(held, currency)} is still held against this rental.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="d-amount">Amount to give back</Label>
          <Input
            id="d-amount"
            type="number"
            min={0}
            max={held}
            value={amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
            className="tabular-nums"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={refund.isPending || !amount}
            onClick={() =>
              refund.mutate(
                { rentalId: rental.id, amount: Number(amount), method: "cash" },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {refund.isPending && <Spinner />}
            Return it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({
  open,
  onOpenChange,
  rentalId,
  code,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rentalId: string
  code: string
}) {
  const cancel = useCancelRental()
  const [reason, setReason] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel {code}?</DialogTitle>
          <DialogDescription>
            Everything on it goes straight back on the shelf. Only possible because nothing has been
            returned or paid yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Why (optional)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Entered twice, customer changed their mind…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ rentalId, reason }, { onSuccess: () => onOpenChange(false) })}
          >
            {cancel.isPending && <Spinner />}
            Cancel the rental
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
