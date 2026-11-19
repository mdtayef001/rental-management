"use client"

import { useState } from "react"
import { Download, MessageCircle, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { ErrorState, PageHeader, SimpleSelect, Spinner, TableSkeleton } from "@/components/common"
import { BillDocument, PeriodPicker } from "@/components/bill"
import { PrintButton } from "@/components/paper"
import { BILL_TITLE, periodName, rangeQuery } from "@/lib/bills"
import { useReceivePayment } from "@/lib/data/mutations"
import { billPdfUrl, useBill } from "@/lib/data/queries"
import { money, whatsappLink } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/rental"
import type { Bill } from "@/lib/types"
import { usePeriod } from "../view"
import { t } from "@/lib/i18n"

/**
 * One customer's bill, with everything you do to a bill around it.
 *
 * The sheet itself is the document; the buttons above it — download, print, send, take a
 * payment — are hidden when it prints, so paper carries the bill and nothing else.
 *
 * Money paid in advance on a rental is already in "Payments received", so a customer who
 * paid ahead sees it taken off the bill, or the bill shown in credit.
 */
export function BillView({ customerId }: { customerId: string }) {
  const [range, setRange] = usePeriod()
  const [paying, setPaying] = useState(false)
  const { data: bill, isLoading, isFetching, isError, error, refetch } = useBill(customerId, range)

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  const share = bill ? whatsappLink(bill.customer.phone, message(bill)) : null

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="space-y-4 print:hidden">
        <PageHeader
          title={bill ? `${t(BILL_TITLE[bill.kind])} · ${bill.customer.company || bill.customer.name}` : t("Bill")}
          description={bill ? periodName(bill) + (isFetching ? ` · ${t("updating…")}` : "") : undefined}
          back={{ href: `/bills?${rangeQuery(range)}`, label: t("Bills") }}
        >
          <Button variant="outline" onClick={() => setPaying(true)} disabled={!bill}>
            <Wallet className="size-4" />
            {t("Take payment")}
          </Button>
          {share && (
            <Button variant="outline" render={<a href={share} target="_blank" rel="noreferrer" />}>
              <MessageCircle className="size-4" />
              {t("WhatsApp")}
            </Button>
          )}
          <PrintButton label={t("Print")} />
          <Button render={<a href={billPdfUrl(customerId, range)} download />}>
            <Download className="size-4" />
            {t("Download PDF")}
          </Button>
        </PageHeader>
        <PeriodPicker range={range} onChange={setRange} />
      </div>

      {isLoading || !bill ? <TableSkeleton rows={8} columns={4} /> : <BillDocument bill={bill} />}

      {bill && paying && <PaymentDialog bill={bill} onClose={() => setPaying(false)} />}
    </div>
  )
}

/** The few lines that go with the PDF when it is sent on WhatsApp. */
function message(bill: Bill) {
  const cash = (value: number) => money(value, bill.business.currency)
  const due = bill.totals.closingBalance
  return [
    t("Hello {name},", { name: bill.customer.name }),
    t("Here is your {bill} from {business} for {period} ({number}).", {
      bill: t(BILL_TITLE[bill.kind]).toLowerCase(),
      business: bill.business.name,
      period: periodName(bill),
      number: bill.number,
    }),
    t("Charged this period: {amount}", { amount: cash(bill.totals.charges) }),
    due < 0 ? t("You are in credit by {amount}.", { amount: cash(-due) }) : t("Amount due: {amount}", { amount: cash(due) }),
  ].join("\n")
}

/**
 * One payment for the whole bill.
 *
 * A company pays its month with one cheque, so this takes one amount and the server
 * spreads it over their rentals, oldest first — nobody has to split it by hand.
 */
function PaymentDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const due = bill.totals.closingBalance
  const pay = useReceivePayment()
  const [amount, setAmount] = useState<number | "">(due > 0 ? due : "")
  const [method, setMethod] = useState("cash")
  const [reference, setReference] = useState("")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Take a payment")}</DialogTitle>
          <DialogDescription>
            {due > 0
              ? `${t("{amount} is due on this bill.", { amount: money(due, bill.business.currency) })} `
              : `${t("Nothing is due on this bill.")} `}
            {t("It goes against their oldest unpaid rental first.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bill-amount">{t("Amount")}</Label>
            <Input
              id="bill-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
              className="tabular-nums"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-method">{t("How")}</Label>
            <SimpleSelect id="bill-method" value={method} onChange={setMethod} options={PAYMENT_METHODS} />
          </div>
          {method !== "cash" && (
            <div className="space-y-1.5">
              <Label htmlFor="bill-ref">{method === "bank" ? t("Cheque or transfer number") : t("Transaction ID")}</Label>
              <Input id="bill-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={pay.isPending || !amount}
            onClick={() =>
              pay.mutate(
                { customerId: bill.customer.id, amount: Number(amount), method, reference },
                { onSuccess: onClose },
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
