import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { RentalDetailView } from "./view"

export const metadata: Metadata = { title: "Rental" }

export default async function RentalPage({ params }: PageProps<"/rentals/[id]">) {
  await requireAccess("/rentals")
  const { id } = await params
  return <RentalDetailView id={id} />
}
