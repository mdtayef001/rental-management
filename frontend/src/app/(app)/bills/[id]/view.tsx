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
import { BILL_TITLE, rangeQuery } from "@/lib/bills"
import { useReceivePayment } from "@/lib/data/mutations"
import { billPdfUrl, useBill } from "@/lib/data/queries"
import { money, whatsappLink } from "@/lib/format"
import type { Bill } from "@/lib/types"
import { usePeriod } from "../view"

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
          title={bill ? `${BILL_TITLE[bill.kind]} · ${bill.customer.company || bill.customer.name}` : "Bill"}
          description={bill ? bill.label + (isFetching ? " · updating…" : "") : undefined}
          back={{ href: `/bills?${rangeQuery(range)}`, label: "Bills" }}
        >
          <Button variant="outline" onClick={() => setPaying(true)} disabled={!bill}>
            <Wallet className="size-4" />
            Take payment
          </Button>
          {share && (
            <Button variant="outline" render={<a href={share} target="_blank" rel="noreferrer" />}>
              <MessageCircle className="size-4" />
              WhatsApp
            </Button>
          )}
          <PrintButton label="Print" />
          <Button render={<a href={billPdfUrl(customerId, range)} download />}>
            <Download className="size-4" />
            Download PDF
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
    `Hello ${bill.customer.name},`,
    `Here is your ${BILL_TITLE[bill.kind].toLowerCase()} from ${bill.business.name} for ${bill.label} (${bill.number}).`,
    `Charged this period: ${cash(bill.totals.charges)}`,
    due < 0 ? `You are in credit by ${cash(-due)}.` : `Amount due: ${cash(due)}`,
  ].join("\n")
}

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "mobile", label: "Mobile banking" },
  { value: "card", label: "Card" },
]

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
          <DialogTitle>Take a payment</DialogTitle>
          <DialogDescription>
            {due > 0
              ? `${money(due, bill.business.currency)} is due on this bill. `
              : "Nothing is due on this bill. "}
            It goes against their oldest unpaid rental first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bill-amount">Amount</Label>
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
            <Label htmlFor="bill-method">How</Label>
            <SimpleSelect id="bill-method" value={method} onChange={setMethod} options={METHODS} />
          </div>
          {method !== "cash" && (
            <div className="space-y-1.5">
              <Label htmlFor="bill-ref">{method === "bank" ? "Cheque or transfer number" : "Transaction ID"}</Label>
              <Input id="bill-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
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
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
