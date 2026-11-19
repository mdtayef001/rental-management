import { requireAccess } from "@/lib/auth/dal"
import { RentalsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Rentals")

export default async function RentalsPage() {
  await requireAccess("/rentals")
  return <RentalsView />
}
