import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ReturnsView } from "./view"

export const metadata: Metadata = { title: "Returns" }

export default async function ReturnsPage() {
  await requireAccess("/returns")
  return <ReturnsView />
}
