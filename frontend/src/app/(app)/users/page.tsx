import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { UsersView } from "./view"

export const metadata: Metadata = { title: "Team" }

export default async function UsersPage() {
  await requireAccess("/users")
  return <UsersView />
}
