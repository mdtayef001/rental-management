import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getContext } from "@/lib/auth/dal"
import { ROLE_HOME } from "@/lib/auth/roles"
import { deleteSession } from "@/lib/auth/session"

// A route rather than a page, so the browser can be sent here from anywhere — including
// from a failed API call in a client component — and come back logged out.
//
// It stays a GET because server components can only redirect, but another site must not be
// able to end a working session by linking here: the cookies are SameSite=Lax, so they ride
// along on a cross-site link. Browsers mark such navigations `Sec-Fetch-Site: cross-site`
// (this app's own links arrive as same-origin, or "none" when typed in). A cross-site
// request only logs out when Django already refuses the session — that is also the case
// where the DAL sent the browser here after arriving from another site, and it must not
// bounce back and forth.
export async function GET(request: Request) {
  // Said on the login page, so a logout nobody asked for doesn't look like a fault.
  const idle = new URL(request.url).searchParams.get("reason") === "idle"
  const site = (await headers()).get("sec-fetch-site")
  if (site === "cross-site" || site === "same-site") {
    const ctx = await getContext().catch(() => null)
    if (ctx) redirect(ROLE_HOME[ctx.user.role])
  }
  await deleteSession()
  redirect(idle ? "/login?reason=idle" : "/login")
}
