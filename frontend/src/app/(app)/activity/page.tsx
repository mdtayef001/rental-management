import { requireAccess } from "@/lib/auth/dal"
import { ActivityView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Activity")

export default async function ActivityPage() {
  await requireAccess("/activity")
  return <ActivityView />
}
