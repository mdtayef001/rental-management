import { requireAccess } from "@/lib/auth/dal"
import { TakeBackView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Take back")

export default async function TakeBackPage() {
  // Checks the role, the rentals module and the staff member's canTakeReturns right.
  await requireAccess("/take-back")
  return <TakeBackView />
}
