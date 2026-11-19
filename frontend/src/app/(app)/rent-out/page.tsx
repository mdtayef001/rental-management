import { requireAccess } from "@/lib/auth/dal"
import { RentOutView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Rent out")

export default async function RentOutPage() {
  // Checks the role, the rentals module and the staff member's canRent right.
  await requireAccess("/rent-out")
  return <RentOutView />
}
