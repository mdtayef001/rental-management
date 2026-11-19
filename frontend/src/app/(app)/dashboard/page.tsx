import { requireAccess } from "@/lib/auth/dal"
import { DashboardView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Dashboard")

export default async function DashboardPage() {
  const { business } = await requireAccess("/dashboard")
  return <DashboardView businessName={business.name} />
}
