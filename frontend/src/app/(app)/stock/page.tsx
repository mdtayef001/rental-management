import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { StockView } from "./view"

export const metadata: Metadata = { title: "Stock" }

export default async function StockPage() {
  const { user } = await requireAccess("/stock")
  return <StockView canAdjust={user.role !== "staff" || user.canAddStock} />
}
