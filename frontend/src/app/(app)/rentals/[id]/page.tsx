import { requireAccess } from "@/lib/auth/dal"
import { RentalDetailView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Rental")

export default async function RentalPage({ params }: PageProps<"/rentals/[id]">) {
  await requireAccess("/rentals")
  const { id } = await params
  return <RentalDetailView id={id} />
}
