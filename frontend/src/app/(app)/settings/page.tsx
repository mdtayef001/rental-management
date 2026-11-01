import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SettingsView } from "./view"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  // Owners only — the route rules enforce this, and so does Django.
  const { business } = await requireAccess("/settings")
  return <SettingsView business={business} />
}
