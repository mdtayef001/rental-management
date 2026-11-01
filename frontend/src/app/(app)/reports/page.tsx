import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ReportsView } from "./view"

export const metadata: Metadata = { title: "Reports" }

export default async function ReportsPage() {
  // Owners, and managers the owner has given "See profit and reports". Django checks the
  // same thing on every endpoint behind this screen.
  const { business } = await requireAccess("/reports")
  return <ReportsView canSeeSpend={business.settings.modules.purchases} />
}
