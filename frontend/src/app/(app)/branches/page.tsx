import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { BranchesView } from "./view"

export const metadata: Metadata = { title: "Branches" }

export default async function BranchesPage() {
  await requireAccess("/branches")
  return <BranchesView />
}
