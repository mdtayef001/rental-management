import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { CustomersView } from "./view"

export const metadata: Metadata = { title: "Customers" }

export default async function CustomersPage() {
  await requireAccess("/customers")
  return <CustomersView />
}
