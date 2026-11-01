import { redirect } from "next/navigation"
import { deleteSession } from "@/lib/auth/session"

// A route rather than a page, so the browser can be sent here from anywhere — including
// from a failed API call in a client component — and come back logged out.
export async function GET() {
  await deleteSession()
  redirect("/login")
}
