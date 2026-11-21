import "server-only"
import { jwtVerify } from "jose"
import { cookies } from "next/headers"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS } from "@/lib/api/errors"
import type { Role } from "@/lib/types"

// Login tokens come from Django (SimpleJWT) and live in httpOnly cookies, so browser
// JavaScript never sees them — an XSS bug in a dependency can't walk off with a session.
// The access token is short-lived; proxy.ts swaps in a new one using the refresh token
// shortly before it runs out, and each swap also brings a new refresh token good for
// another 12 hours. So someone working is never logged out; the 15-minute idle logout
// is done in the browser (components/idle-logout.tsx).

export const ACCESS_COOKIE = "rm_access"
export const REFRESH_COOKIE = "rm_refresh"
// These must match ACCESS_TOKEN_LIFETIME and REFRESH_TOKEN_LIFETIME in backend/config/settings.py.
const ACCESS_SECONDS = 15 * 60
const REFRESH_SECONDS = 12 * 60 * 60
/**
 * Renew this long before the access token expires. A token checked here as valid with a
 * second to spare would otherwise reach Django already expired — and a refused token
 * logs the user out.
 */
export const RENEW_EARLY_SECONDS = 2 * 60
const ROLES: Role[] = ["superadmin", "owner", "manager", "staff"]

export interface SessionPayload {
  userId: string
  role: Role
  tenantId: string | null
  /** From the token, so the proxy can hide a route before anything renders. */
  canRent: boolean
  /** When the token expires, in seconds since 1970. */
  expiresAt: number
}

export interface Tokens {
  access: string
  refresh?: string
}

function key() {
  const secret = process.env.JWT_SIGNING_KEY
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SIGNING_KEY must be set to the same value as in backend/.env (see .env.example)")
  }
  return new TextEncoder().encode(secret)
}

/**
 * Checks the signature and expiry of an access token.
 *
 * Used for fast routing only. It says the token is genuine, not that the account still
 * exists or still has that role — Django re-checks every API call, and the DAL re-asks on
 * every page. Never make an authorisation decision on this alone.
 */
export async function verifyAccess(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] })
    if (payload.token_type !== "access" || !ROLES.includes(payload.role as Role)) return null
    return {
      userId: String(payload.user_id),
      role: payload.role as Role,
      tenantId: (payload.tenant_id as string | null) ?? null,
      canRent: payload.can_rent !== false,
      expiresAt: payload.exp ?? 0,
    }
  } catch {
    return null
  }
}

/** Whether a token is close enough to expiry to renew now rather than risk it running out in flight. */
export function needsRenewal(session: SessionPayload, now = Date.now() / 1000) {
  return session.expiresAt - now < RENEW_EARLY_SECONDS
}

/**
 * What came of trying to renew: new tokens; a refusal, meaning the login is over (expired,
 * logged out, password reset, account disabled); or no answer at all.
 */
export type Renewal = { tokens: Tokens } | { refused: true } | { unreachable: true }

/**
 * Trades a refresh token for a new access token, and a new refresh token that extends the
 * login (Django rotates them).
 *
 * "No answer" is kept apart from "refused" on purpose: a slow cold start or a dropped
 * connection must not end anyone's session. Only Django saying no does that.
 */
export async function refreshAccess(refresh: string): Promise<Renewal> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
    // 400/401: the token is bad, expired or blacklisted. Anything else (a 5xx, a 429) is
    // the server having a moment, not a verdict on the login.
    if (res.status === 400 || res.status === 401) return { refused: true }
    if (!res.ok) return { unreachable: true }
    const data = (await res.json()) as { access?: string; refresh?: string }
    return data.access ? { tokens: { access: data.access, refresh: data.refresh } } : { unreachable: true }
  } catch {
    return { unreachable: true }
  }
}

export function cookieOptions(name: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: name === ACCESS_COOKIE ? ACCESS_SECONDS : REFRESH_SECONDS,
  }
}

export async function createSession(tokens: Tokens) {
  const jar = await cookies()
  jar.set(ACCESS_COOKIE, tokens.access, cookieOptions(ACCESS_COOKIE))
  if (tokens.refresh) jar.set(REFRESH_COOKIE, tokens.refresh, cookieOptions(REFRESH_COOKIE))
}

/** Logs out: blacklists the refresh token in Django, then clears both cookies. */
export async function deleteSession() {
  const jar = await cookies()
  const refresh = jar.get(REFRESH_COOKIE)?.value
  if (refresh) {
    // Best effort: even if Django is unreachable, the cookies still go.
    await fetch(`${API_URL}/auth/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    }).catch(() => undefined)
  }
  jar.delete(ACCESS_COOKIE)
  jar.delete(REFRESH_COOKIE)
}
