import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { CustomerDetailView } from "./view"

export const metadata: Metadata = { title: "Customer" }

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  await requireAccess("/customers")
  const { id } = await params
  return <CustomerDetailView id={id} />
}
