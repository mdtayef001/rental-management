import { requireAccess } from "@/lib/auth/dal"
import { ReturnsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Returns")

export default async function ReturnsPage() {
  await requireAccess("/returns")
  return <ReturnsView />
}
