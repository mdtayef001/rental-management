import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { BillsView } from "./view"

export const metadata: Metadata = { title: "Bills" }

/** Month end: every customer with something to bill, and how much. */
export default async function BillsPage() {
  await requireAccess("/bills")
  return <BillsView />
}
