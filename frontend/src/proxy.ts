import { NextResponse, type NextRequest } from "next/server"
import { ROLE_HOME, canAccess, isAppRoute } from "@/lib/auth/roles"
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions, refreshAccess, verifyAccess } from "@/lib/auth/session"

// The first of three checks.
//
// This one is fast and happens before anything renders: it verifies the token's signature
// and sends the user away if they have no business on this route. It also renews the
// short-lived access token from the refresh token, so pages, server actions and
// /api/backend always see a valid one and nobody is logged out mid-task.
//
// It is NOT the security boundary. The DAL (lib/auth/dal.ts) re-asks Django who the user
// is on every page, and Django authorises every API call. This just saves a round trip and
// stops a logged-out browser from flashing a page it can't have.
export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname

  // Logging out: pass straight through without renewing. Renewing here would attach a
  // fresh access cookie to the very response /logout clears the cookies on, and the
  // browser would arrive at /login still holding a valid session — which this proxy then
  // bounces to the role's home page, so the logout looks like it went somewhere random.
  if (path === "/logout") return NextResponse.next({ request: { headers: req.headers } })

  let session = await verifyAccess(req.cookies.get(ACCESS_COOKIE)?.value)
  let renewed: string | null = null
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value

  if (!session && refresh) {
    renewed = await refreshAccess(refresh)
    session = await verifyAccess(renewed ?? undefined)
    // Hand the new token to whatever renders this request, not just to the browser.
    if (renewed) req.cookies.set(ACCESS_COOKIE, renewed)
  }

  const res = route(req, path, session)
  if (renewed) {
    res.cookies.set(ACCESS_COOKIE, renewed, cookieOptions(ACCESS_COOKIE))
  } else if (refresh && !session) {
    // The login expired or was logged out elsewhere: clear the dead cookies so the browser
    // stops sending them.
    res.cookies.delete(ACCESS_COOKIE)
    res.cookies.delete(REFRESH_COOKIE)
  }
  return res
}

function route(req: NextRequest, path: string, session: Awaited<ReturnType<typeof verifyAccess>>) {
  const next = () => NextResponse.next({ request: { headers: req.headers } })

  // The browser's own API calls: the token has been renewed above, which is all they need.
  if (path.startsWith("/api/")) return next()

  if (path === "/" || path === "/login") {
    if (session) return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    return path === "/" ? NextResponse.redirect(new URL("/login", req.nextUrl)) : next()
  }

  if (isAppRoute(path)) {
    if (!session) {
      const to = new URL("/login", req.nextUrl)
      // Come back here after logging in, so a bookmarked page isn't lost.
      if (path !== "/") to.searchParams.set("next", path)
      return NextResponse.redirect(to)
    }
    if (!canAccess(session, path)) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    }
  }

  return next()
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|ico|webp)$).*)",
    // The browser's API calls, so their access token gets renewed too.
    "/api/backend/:path*",
  ],
}
