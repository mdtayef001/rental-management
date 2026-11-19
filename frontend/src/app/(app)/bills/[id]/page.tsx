import { requireAccess } from "@/lib/auth/dal"
import { BillView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Bill")

/** One customer's bill for a month or a year: read it, print it, or send it as a PDF. */
export default async function BillPage({ params }: PageProps<"/bills/[id]">) {
  await requireAccess("/bills")
  const { id } = await params
  return <BillView customerId={id} />
}
