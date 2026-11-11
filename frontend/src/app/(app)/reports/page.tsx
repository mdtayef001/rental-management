import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ReportsView } from "./view"

export const metadata: Metadata = { title: "Reports" }

export default async function ReportsPage() {
  await requireAccess("/reports")
  return <ReportsView />
}
