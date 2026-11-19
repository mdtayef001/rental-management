import { requireSuperAdmin } from "@/lib/auth/dal"
import { PlatformView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Platform")

export default async function PlatformPage() {
  await requireSuperAdmin()
  return <PlatformView />
}
