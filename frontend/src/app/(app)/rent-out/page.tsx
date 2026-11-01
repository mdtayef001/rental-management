import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { RentOutView } from "./view"

export const metadata: Metadata = { title: "Rent out" }

export default async function RentOutPage() {
  // Checks the role, the rentals module and the staff member's canRent right.
  await requireAccess("/rent-out")
  return <RentOutView />
}
