import { requireAccess } from "@/lib/auth/dal"
import { ScanView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Scan")

export default async function ScanPage() {
  const { user } = await requireAccess("/scan")
  // The two actions are gated separately: a staff member may be allowed to take returns
  // but not to rent out, or the other way round.
  return <ScanView canRent={user.role !== "staff" || user.canRent} canTakeReturns={user.role !== "staff" || user.canTakeReturns} />
}
