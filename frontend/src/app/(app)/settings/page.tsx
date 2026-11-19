import { requireAccess } from "@/lib/auth/dal"
import { SettingsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Settings")

export default async function SettingsPage() {
  // Owners only — the route rules enforce this, and so does Django.
  const { business } = await requireAccess("/settings")
  return <SettingsView business={business} />
}
