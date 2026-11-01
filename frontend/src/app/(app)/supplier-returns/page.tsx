import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SupplierReturnsView } from "./view"

export const metadata: Metadata = { title: "Sent back to supplier" }

export default async function SupplierReturnsPage() {
  await requireAccess("/supplier-returns")
  return <SupplierReturnsView />
}
