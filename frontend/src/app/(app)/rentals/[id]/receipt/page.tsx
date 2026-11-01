import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ReceiptView } from "./view"

export const metadata: Metadata = { title: "Receipt" }

/** The team's copy of a rental's receipt: print it, or send the customer their link. */
export default async function RentalReceiptPage({ params }: PageProps<"/rentals/[id]/receipt">) {
  await requireAccess("/rentals")
  const { id } = await params
  return <ReceiptView id={id} />
}
