import { requireAccess } from "@/lib/auth/dal"
import { ProductDetailView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Product")

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { user, business } = await requireAccess("/products")
  const { id } = await params
  const canEdit = user.role !== "staff" || business.settings.permissions.staffCreateProducts
  return <ProductDetailView id={id} canEdit={canEdit} canAdjust={user.canAddStock || user.role !== "staff"} />
}
