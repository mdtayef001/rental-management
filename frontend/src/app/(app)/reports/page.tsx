import { requireAccess } from "@/lib/auth/dal"
import { ReportsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Reports")

export default async function ReportsPage() {
  await requireAccess("/reports")
  return <ReportsView />
}
