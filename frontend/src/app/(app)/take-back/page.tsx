import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { TakeBackView } from "./view"

export const metadata: Metadata = { title: "Take back" }

export default async function TakeBackPage() {
  // Checks the role, the rentals module and the staff member's canTakeReturns right.
  await requireAccess("/take-back")
  return <TakeBackView />
}
