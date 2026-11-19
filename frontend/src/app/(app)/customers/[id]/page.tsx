import { requireAccess } from "@/lib/auth/dal"
import { CustomerDetailView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Customer")

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  await requireAccess("/customers")
  const { id } = await params
  return <CustomerDetailView id={id} />
}
