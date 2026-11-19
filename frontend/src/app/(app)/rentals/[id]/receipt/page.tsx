import { requireAccess } from "@/lib/auth/dal"
import { ReceiptView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Receipt")

/** The team's copy of a rental's receipt: print it, or send the customer their link. */
export default async function RentalReceiptPage({ params }: PageProps<"/rentals/[id]/receipt">) {
  await requireAccess("/rentals")
  const { id } = await params
  return <ReceiptView id={id} />
}
