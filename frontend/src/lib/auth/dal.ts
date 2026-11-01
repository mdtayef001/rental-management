import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { ApiError } from "@/lib/api/errors"
import { api } from "@/lib/api/server"
import type { Business, Role, SessionUser } from "@/lib/types"
import { ROLE_HOME, canAccess } from "./roles"

export interface Context {
  user: SessionUser
  /** The user's business. Null only for the platform super admin. */
  business: Business | null
}

/**
 * Data access layer: the one place that turns a login into a user.
 *
 * It asks Django on every request rather than trusting the token's claims, so disabling an
 * account, changing someone's role or suspending a business takes effect immediately even
 * while a valid access token is still in the cookie. `cache` keeps it to one call per
 * request however many components ask.
 */
export const getContext = cache(async (): Promise<Context | null> => {
  let me: { user: SessionUser; business: Business | null }
  try {
    me = await api("auth/me/")
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
    throw err
  }
  const { user, business } = me
  if (user.role === "superadmin") return { user, business: null }
  if (!business || business.suspended) return null
  return { user, business }
})

export async function getCurrentUser() {
  return (await getContext())?.user ?? null
}

/** Use at the top of a page or server action. Redirects rather than rendering an error. */
export async function requireRole(roles: Role[]): Promise<Context> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (!roles.includes(ctx.user.role)) redirect(ROLE_HOME[ctx.user.role])
  return ctx
}

/** Business pages: checks the role, the owner's feature switches and the per-person rights. */
export async function requireAccess(path: string): Promise<{ user: SessionUser; business: Business }> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  const { user, business } = ctx
  if (!business || !canAccess(user, path, business.settings)) redirect(ROLE_HOME[user.role])
  return { user, business }
}

/** The super admin's platform pages. */
export async function requireSuperAdmin(): Promise<{ user: SessionUser }> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (ctx.user.role !== "superadmin") redirect(ROLE_HOME[ctx.user.role])
  return { user: ctx.user }
}
