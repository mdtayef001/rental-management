import { requireAccess } from "@/lib/auth/dal"
import { CustomersView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Customers")

export default async function CustomersPage() {
  await requireAccess("/customers")
  return <CustomersView />
}
