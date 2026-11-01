import { cookies } from "next/headers"
import type { NextRequest } from "next/server"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS } from "@/lib/api/errors"
import { ACCESS_COOKIE } from "@/lib/auth/session"

// The browser's only way to Django.
//
// The point of routing through here is that the access token stays in an httpOnly cookie:
// this handler reads it server-side and sets the Authorization header, so no script in the
// page can ever read a token, and an XSS bug can't exfiltrate a session.
//
// It deliberately does NOT decide what the caller may do. Django authorises every request,
// so this forwards and gets out of the way.

const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"])

async function forward(req: NextRequest, path: string[]) {
  if (!METHODS.has(req.method)) {
    return Response.json({ detail: "Method not allowed." }, { status: 405 })
  }

  const access = (await cookies()).get(ACCESS_COOKIE)?.value

  // Every Django route ends in a slash, and both the catch-all segments array and Next's
  // own path normalisation drop it. Django can redirect a GET to the slashed URL, but it
  // cannot redirect a POST without losing the body — it raises instead, so a missing slash
  // turns every write into a 500. Add it back unconditionally.
  const route = path.join("/").replace(/\/+$/, "")
  const target = `${API_URL}/${route}/${req.nextUrl.search}`
  // DELETE carries a body here — deleting a business makes the super admin type its name
  // back, and that confirmation travels with the request. Dropping it would turn every
  // such delete into a 400.
  const body = req.method === "GET" ? undefined : await req.text()

  let res: Response
  try {
    res = await fetch(target, {
      method: req.method,
      headers: {
        Accept: "application/json",
        ...(body && { "Content-Type": "application/json" }),
        ...(access && { Authorization: `Bearer ${access}` }),
      },
      body: body || undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError"
    return Response.json(
      { detail: timedOut ? "The server took too long to answer." : "Couldn't reach the server." },
      { status: timedOut ? 504 : 503 },
    )
  }

  if (res.status === 204) return new Response(null, { status: 204 })

  // A file download (the CSV exports) is piped straight through rather than read into a
  // string: a year of returns is a big file, and the owner's browser should start saving it
  // while Django is still writing it. The disposition header has to survive too, or the
  // browser names the file after this route instead of the report.
  const type = res.headers.get("Content-Type") ?? "application/json"
  const disposition = res.headers.get("Content-Disposition")
  if (res.ok && disposition) {
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": type, "Content-Disposition": disposition, "Cache-Control": "no-store" },
    })
  }

  // Everything else: pass the body through untouched, so DRF's error shapes survive for
  // errorMessage().
  const text = await res.text()
  return new Response(text, { status: res.status, headers: { "Content-Type": type } })
}

type Params = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Params) {
  return forward(req, (await params).path)
}
export async function POST(req: NextRequest, { params }: Params) {
  return forward(req, (await params).path)
}
export async function PATCH(req: NextRequest, { params }: Params) {
  return forward(req, (await params).path)
}
export async function PUT(req: NextRequest, { params }: Params) {
  return forward(req, (await params).path)
}
export async function DELETE(req: NextRequest, { params }: Params) {
  return forward(req, (await params).path)
}
