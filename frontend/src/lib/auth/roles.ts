// Route permissions.
//
// No server-only imports, so proxy.ts, server pages and client components all share one
// set of rules. The same rules exist in backend/apps/accounts/permissions.py: a route
// hidden here is also refused there, because hiding a link is not a security control.

import type { BusinessSettings, ModuleId, PermissionId, RightId, Role, SessionUser, TenantRole } from "@/lib/types"

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super admin",
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
}

/** "Owner" for the business's first owner, "Admin" for any later owner-level account. */
export function roleLabel(user: Pick<SessionUser, "role" | "isMainOwner">) {
  return user.role === "owner" && !user.isMainOwner ? "Admin" : ROLE_LABEL[user.role]
}

/** Where each role lands after logging in. Staff go straight to the scan screen. */
export const ROLE_HOME: Record<Role, string> = {
  superadmin: "/platform",
  owner: "/dashboard",
  manager: "/dashboard",
  staff: "/scan",
}

const TEAM: Role[] = ["owner", "manager", "staff"]
const LEADS: Role[] = ["owner", "manager"]

interface Rule {
  test: (path: string) => boolean
  roles: Role[]
  /** Hidden when the owner switches this feature off. */
  module?: ModuleId
  /** Managers need this permission from the owner. */
  permission?: PermissionId
  /** Staff need this per-person right; owners and managers always have it. */
  right?: RightId
}

const prefix = (p: string) => (path: string) => path === p || path.startsWith(p + "/")

/** First match wins. Anything not listed is owner/manager only, so a new page is private by default. */
const ROUTE_RULES: Rule[] = [
  { test: prefix("/platform"), roles: ["superadmin"] },
  { test: prefix("/scan"), roles: TEAM, module: "rentals" },
  { test: prefix("/rent-out"), roles: TEAM, module: "rentals", right: "canRent" },
  { test: prefix("/take-back"), roles: TEAM, module: "rentals", right: "canTakeReturns" },
  { test: prefix("/rentals"), roles: TEAM, module: "rentals" },
  { test: prefix("/returns"), roles: TEAM, module: "rentals" },
  { test: prefix("/customers"), roles: TEAM },
  { test: prefix("/products"), roles: TEAM },
  { test: prefix("/users"), roles: LEADS, permission: "managerUsers" },
  { test: prefix("/activity"), roles: LEADS, permission: "managerActivity" },
  { test: prefix("/settings"), roles: ["owner"] },
  { test: prefix("/reports"), roles: LEADS, permission: "managerProfit" },
  { test: prefix("/suppliers"), roles: LEADS, module: "purchases", permission: "managerPurchases" },
  { test: prefix("/purchases"), roles: LEADS, module: "purchases", permission: "managerPurchases" },
  { test: prefix("/supplier-returns"), roles: LEADS, module: "purchases", permission: "managerPurchases" },
  { test: prefix("/dashboard"), roles: LEADS },
]

/** Every path the app owns. Anything else (login, receipts, static files) is public. */
export const APP_ROUTES = [
  "/platform",
  "/dashboard",
  "/scan",
  "/rent-out",
  "/take-back",
  "/rentals",
  "/returns",
  "/customers",
  "/products",
  "/suppliers",
  "/purchases",
  "/supplier-returns",
  "/users",
  "/activity",
  "/reports",
  "/settings",
]

export function isAppRoute(path: string) {
  return APP_ROUTES.some((p) => prefix(p)(path))
}

/**
 * Can this user open this path?
 *
 * Without `settings` — which is the case in proxy.ts, where only the token is available —
 * the role and the per-person right are checked. Pages pass the business settings for the
 * full check including modules and manager permissions.
 */
export function canAccess(
  user: { role: Role; canRent?: boolean; canTakeReturns?: boolean; canSell?: boolean; canAddStock?: boolean; canHandleDeposits?: boolean },
  path: string,
  settings?: BusinessSettings,
) {
  const rule = ROUTE_RULES.find((r) => r.test(path))
  const roles = rule?.roles ?? LEADS
  if (!roles.includes(user.role)) return false
  // Only staff are limited by the per-person rights.
  if (rule?.right && user.role === "staff" && user[rule.right] === false) return false
  if (!settings || !rule) return true
  if (rule.module && !settings.modules[rule.module]) return false
  if (rule.permission && user.role === "manager" && !settings.permissions[rule.permission]) return false
  return true
}

/** Owners can do everything in their business; others need the owner's switch. */
export function hasPermission(role: Role, permission: PermissionId, settings: BusinessSettings) {
  if (role === "owner") return true
  const needs = permission.startsWith("staff") ? "staff" : "manager"
  return role === needs && settings.permissions[permission]
}

/**
 * Which roles `user` may hand out. Only the Owner makes more owner-level accounts;
 * admins make managers and staff, managers make staff. Same rules as Django.
 */
export function creatableRoles(user: Pick<SessionUser, "role" | "isMainOwner">): TenantRole[] {
  if (user.role === "owner") return user.isMainOwner ? ["owner", "manager", "staff"] : ["manager", "staff"]
  if (user.role === "manager") return ["staff"]
  return []
}

/**
 * Whether `actor` may edit, disable or delete `user`: nobody changes themselves here,
 * nobody touches the Owner, and only the Owner touches other owner-level accounts.
 */
export function canManageUser(
  actor: Pick<SessionUser, "id" | "role" | "isMainOwner">,
  user: Pick<SessionUser, "id" | "role" | "isMainOwner">,
) {
  if (actor.id === user.id || user.isMainOwner) return false
  if (user.role === "owner") return actor.isMainOwner
  if (actor.role === "manager") return user.role === "staff"
  return actor.role === "owner"
}
