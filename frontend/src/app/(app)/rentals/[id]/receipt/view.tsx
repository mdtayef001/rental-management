"use client"

import { Copy, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ErrorState, PageHeader, TableSkeleton } from "@/components/common"
import { PrintButton, ReceiptDocument } from "@/components/receipt"
import { useSession } from "@/components/session"
import { useRental } from "@/lib/data/queries"
import { whatsappLink } from "@/lib/format"
import { fromRental } from "@/lib/receipt"

/**
 * One rental's receipt, on its own page.
 *
 * Separate from the rental screen on purpose: this is the thing you hand over or print,
 * and printing it should not mean printing a page full of buttons. Everything here except
 * the till copy is hidden when the page is printed.
 */
export function ReceiptView({ id }: { id: string }) {
  const { business } = useSession()
  const { data: rental, isLoading, isError, error, refetch } = useRental(id)

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !rental) return <TableSkeleton rows={6} columns={3} />

  // The origin is only known in the browser; this component only ever renders there.
  const receipt = fromRental(rental, business, rental.branchName, window.location.origin)
  const share = whatsappLink(
    rental.customerPhone,
    `Hello ${rental.customerName}, here is your receipt ${rental.code} from ${business?.name ?? "us"}: ${receipt.link ?? ""}`,
  )

  async function copy() {
    if (!receipt.link) return
    try {
      await navigator.clipboard.writeText(receipt.link)
      toast.success("Receipt link copied. Paste it to the customer.")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="print:hidden">
        <PageHeader title="Receipt" back={{ href: `/rentals/${id}`, label: rental.code }}>
          <PrintButton />
        </PageHeader>
      </div>

      <ReceiptDocument receipt={receipt} />

      {receipt.link && (
        <div className="space-y-3 rounded-xl border p-4 print:hidden">
          <div>
            <h2 className="text-sm font-medium">Send it to the customer</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              They open it on their phone — no login — and the QR code on it starts the return.
            </p>
          </div>
          <p className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all select-all">{receipt.link}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy className="size-4" />
              Copy link
            </Button>
            {share && (
              <Button variant="outline" size="sm" render={<a href={share} target="_blank" rel="noreferrer" />}>
                <MessageCircle className="size-4" />
                WhatsApp
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
