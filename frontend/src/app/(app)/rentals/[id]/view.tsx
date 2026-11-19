"use client"

import { useState } from "react"
import { Ban, FileText, MessageCircle, ReceiptText, Undo2, Wallet } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, PageHeader, Spinner, TableSkeleton } from "@/components/common"
import { Code, DataView, Primary } from "@/components/data-view"

import { useCurrency, useCurrentUser, useSession } from "@/components/session"
import { useCancelRental, useRefund, useRentalPayment } from "@/lib/data/mutations"
import { useRental } from "@/lib/data/queries"
import { count, dateTime, dueLabel, friendlyDateTime, money, plural, whatsappLink } from "@/lib/format"
import { PAYMENT_METHODS, PLAN_LABEL } from "@/lib/rental"
import { StatusBadge } from "../view"
import { msg, t } from "@/lib/i18n"

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

  // Paid beyond what has been charged. While items are out this is their advance, waiting
  // for the rent; once everything is back it is simply money to hand back.
  const credit = Math.max(0, -rental.balance)
  const open = rental.status === "active" || rental.status === "partly_returned"
  const advance = (rental.payments ?? []).filter((p) => p.kind === "advance").reduce((sum, p) => sum + p.amount, 0)
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
        description={`${rental.customerName} · ${t("Out {date}", { date: dateTime(rental.startedAt) })}`}
        back={{ href: "/rentals", label: t("Rentals") }}
      >
        <StatusBadge status={rental.status} overdue={rental.isOverdue} />
        {rental.status !== "cancelled" && rental.status !== "returned" && user.canTakeReturns && (
          <ButtonLink href={`/take-back?rental=${rental.id}`}>
            <Undo2 className="size-4" />
            {t("Take back")}
          </ButtonLink>
        )}
        <ButtonLink href={`/rentals/${rental.id}/receipt`} variant="outline">
          <ReceiptText className="size-4" />
          {t("Receipt")}
        </ButtonLink>
        {rental.customerId && user.role !== "staff" && (
          <ButtonLink href={`/bills/${rental.customerId}`} variant="outline">
            <FileText className="size-4" />
            {t("Monthly bill")}
          </ButtonLink>
        )}
        {share && (
          <Button variant="outline" render={<a href={share} target="_blank" rel="noreferrer" />}>
            <MessageCircle className="size-4" />
            {t("WhatsApp")}
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
              <CardTitle className="text-base">{t("Items")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-md:px-3 max-md:pb-3">
              <DataView
                label={t("Items on this rental")}
                className="md:rounded-none md:border-0"
                rows={rental.items ?? []}
                getKey={(item) => item.id}
                columns={[
                  {
                    id: "product",
                    header: t("Product"),
                    role: "title",
                    cell: (item) => <Primary sub={item.productSku && <Code>{item.productSku}</Code>}>{item.productName}</Primary>,
                  },
                  {
                    id: "still",
                    header: t("Still out"),
                    role: "status",
                    align: "end",
                    cell: (item) =>
                      item.quantityOut > 0 ? (
                        <Badge variant="info">{count(item.quantityOut)} out</Badge>
                      ) : (
                        <Badge variant="success">{t("All back")}</Badge>
                      ),
                  },
                  { id: "out", header: t("Out"), align: "end", cell: (item) => count(item.quantity) },
                  {
                    id: "back",
                    header: t("Back"),
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
                    header: t("Plan"),
                    cell: (item) => (
                      <>
                        {t(PLAN_LABEL[item.plan])}
                        <div className="text-xs text-muted-foreground">{money(item.rate, currency)}</div>
                      </>
                    ),
                  },
                  {
                    id: "charged",
                    header: t("Charged"),
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
                <CardTitle className="text-base">{t("Returns")}</CardTitle>
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
                                {line.condition === "lost" ? t("Not returned") : t("Damaged")}
                              </Badge>
                            )}
                            <span className="ml-2 text-xs">({plural(line.daysOut, "day")})</span>
                          </span>
                          <span className="tabular-nums">{money(line.total, currency)}</span>
                        </li>
                      ))}
                    </ul>
                    {taken.byName && <div className="mt-2 text-xs text-muted-foreground">{t("Taken by {name}", { name: taken.byName })}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(rental.payments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Payments")}</CardTitle>
              </CardHeader>
              <CardContent>
                {/* A list rather than a table: four short facts read fine stacked on a
                    phone and in one line on the counter laptop. */}
                <ul className="divide-y text-sm">
                  {rental.payments?.map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="font-medium">{t(PAYMENT_KIND[payment.kind] ?? payment.kind)}</div>
                        <div className="text-xs text-muted-foreground">
                          {friendlyDateTime(payment.at)}
                          {payment.method && ` · ${t(PAYMENT_METHODS.find((m) => m.value === payment.method)?.label ?? payment.method)}`}
                        </div>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">{money(payment.amount, currency)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {rental.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Notes")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap">{rental.notes}</CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Money")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Line label={t("Rent charged")} value={money(rental.rentTotal, currency)} />
              {rental.lateFee > 0 && <Line label={t("Late fee")} value={money(rental.lateFee, currency)} warn />}
              {rental.damageFee > 0 && <Line label={t("Damage")} value={money(rental.damageFee, currency)} warn />}
              {rental.discount > 0 && <Line label={t("Discount")} value={`− ${money(rental.discount, currency)}`} />}
              {advance > 0 && <Line label={t("Paid in advance")} value={money(advance, currency)} />}
              <Line label={advance > 0 ? t("Paid in total") : t("Paid")} value={money(rental.paidAmount, currency)} />
              <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
                <span>{rental.balance >= 0 ? t("Balance due") : open ? t("In credit") : t("To give back")}</span>
                <span className="tabular-nums">{money(Math.abs(rental.balance), currency)}</span>
              </div>
              {credit > 0 && open && (
                <p className="text-xs text-muted-foreground">
                  {t("Paid ahead. The rent comes off this when the items come back.")}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {rental.status !== "cancelled" && (
                  <Button size="sm" variant={rental.balance > 0 ? "default" : "outline"} onClick={() => setPaying(true)}>
                    <Wallet className="size-4" />
                    {t("Take payment")}
                  </Button>
                )}
                {credit > 0 && user.canTakeReturns && (
                  <Button size="sm" variant="outline" onClick={() => setRefunding(true)}>
                    {t("Give money back")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Line label={t("Customer")} value={rental.customerName} />
              {rental.customerPhone && <Line label={t("Phone")} value={rental.customerPhone} />}
              <Line label={t("Out")} value={dateTime(rental.startedAt)} />
              <Line label={t("Due")} value={rental.dueAt ? dateTime(rental.dueAt) : t("Open-ended")} />
              {rental.returnedAt && <Line label={t("All back")} value={dateTime(rental.returnedAt)} />}
              {rental.createdByName && <Line label={t("Rented out by")} value={rental.createdByName} />}
            </CardContent>
          </Card>

          {user.role !== "staff" && rental.status !== "cancelled" && (rental.returns?.length ?? 0) === 0 && (
            <Button variant="destructive" className="w-full" onClick={() => setCancelling(true)}>
              <Ban className="size-4" />
              {t("Cancel this rental")}
            </Button>
          )}
        </div>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} rental={rental} />
      {refunding && <RefundDialog onClose={() => setRefunding(false)} rental={rental} credit={credit} />}
      <CancelDialog open={cancelling} onOpenChange={setCancelling} rentalId={rental.id} code={rental.code} />
    </div>
  )
}

const PAYMENT_KIND: Record<string, string> = {
  advance: msg("Paid in advance"),
  rent: msg("Payment"),
  refund: msg("Given back"),
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
          <DialogTitle>{t("Take a payment")}</DialogTitle>
          <DialogDescription>
            {rental.balance > 0
              ? t("{amount} is outstanding.", { amount: money(rental.balance, currency) })
              : t("Nothing is owed yet. Money taken now is kept on this rental as an advance.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-amount">{t("Amount")}</Label>
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
            <Label htmlFor="p-method">{t("How")}</Label>
            <select
              id="p-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 w-full rounded-md border bg-card px-2 text-sm"
            >
              {PAYMENT_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
          {method === "mobile" && (
            <div className="space-y-1.5">
              <Label htmlFor="p-ref">{t("Transaction ID")}</Label>
              <Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
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
            {t("Record payment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RefundDialog({
  onClose,
  rental,
  credit,
}: {
  onClose: () => void
  rental: { id: string }
  credit: number
}) {
  const currency = useCurrency()
  const refund = useRefund()
  const [amount, setAmount] = useState<number | "">(credit)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Give money back")}</DialogTitle>
          <DialogDescription>
            {money(credit, currency)} has been paid beyond what this rental has been charged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="d-amount">{t("Amount to give back")}</Label>
          <Input
            id="d-amount"
            type="number"
            min={0}
            max={credit}
            value={amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
            className="tabular-nums"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={refund.isPending || !amount || Number(amount) > credit}
            onClick={() =>
              refund.mutate({ rentalId: rental.id, amount: Number(amount), method: "cash" }, { onSuccess: onClose })
            }
          >
            {refund.isPending && <Spinner />}
            {t("Give it back")}
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
          <DialogTitle>{t("Cancel {code}?", { code })}</DialogTitle>
          <DialogDescription>
            {t("Everything on it goes straight back on the shelf. Only possible because nothing has been returned or paid yet.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">{t("Why (optional)")}</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t("Entered twice, customer changed their mind…")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Keep it")}
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ rentalId, reason }, { onSuccess: () => onOpenChange(false) })}
          >
            {cancel.isPending && <Spinner />}
            {t("Cancel the rental")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
