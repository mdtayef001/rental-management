import { requireAccess } from "@/lib/auth/dal"
import { BillsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Bills")

/** Month end: every customer with something to bill, and how much. */
export default async function BillsPage() {
  await requireAccess("/bills")
  return <BillsView />
}
