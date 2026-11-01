import type { Metadata } from "next"
import { requireSuperAdmin } from "@/lib/auth/dal"
import { PlatformView } from "./view"

export const metadata: Metadata = { title: "Platform" }

export default async function PlatformPage() {
  await requireSuperAdmin()
  return <PlatformView />
}
