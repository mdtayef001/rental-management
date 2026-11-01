import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ProductsView } from "./view"

export const metadata: Metadata = { title: "Products" }

export default async function ProductsPage() {
  const { user, business } = await requireAccess("/products")
  // Staff can only add products if the owner has allowed it.
  const canEdit = user.role !== "staff" || business.settings.permissions.staffCreateProducts
  return <ProductsView canEdit={canEdit} />
}
