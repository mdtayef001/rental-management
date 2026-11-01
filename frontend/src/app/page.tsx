import { redirect } from "next/navigation"
import { getContext } from "@/lib/auth/dal"
import { ROLE_HOME } from "@/lib/auth/roles"

/** Sends each role to its own home. The proxy usually handles this first. */
export default async function Home() {
  const ctx = await getContext()
  redirect(ctx ? ROLE_HOME[ctx.user.role] : "/login")
}
