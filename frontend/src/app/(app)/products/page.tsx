import { requireAccess } from "@/lib/auth/dal"
import { ProductsView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Products")

export default async function ProductsPage() {
  const { user, business } = await requireAccess("/products")
  // Staff can only add products if the owner has allowed it.
  const canEdit = user.role !== "staff" || business.settings.permissions.staffCreateProducts
  // Correcting a shelf count is a separate right: staff may be trusted to count stock
  // without being trusted to invent products, and the other way round.
  const canAdjust = user.role !== "staff" || user.canAddStock
  // Deleting is the owner's and the managers' call only.
  const canDelete = user.role === "owner" || user.role === "manager"
  return <ProductsView canEdit={canEdit} canAdjust={canAdjust} canDelete={canDelete} />
}
