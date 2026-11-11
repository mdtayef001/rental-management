import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { BillView } from "./view"

export const metadata: Metadata = { title: "Bill" }

/** One customer's bill for a month or a year: read it, print it, or send it as a PDF. */
export default async function BillPage({ params }: PageProps<"/bills/[id]">) {
  await requireAccess("/bills")
  const { id } = await params
  return <BillView customerId={id} />
}
