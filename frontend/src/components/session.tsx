"use client"

import { createContext, useContext } from "react"
import type { Business, BusinessSettings, PermissionId, SessionUser } from "@/lib/types"
import { canAccess, hasPermission } from "@/lib/auth/roles"

/**
 * The logged-in user and their business, handed down from the server layout.
 *
 * Client components read this instead of fetching `auth/me` again, so a page costs one
 * request for its own data and nothing for the session. It is for *rendering* decisions —
 * which buttons to show — and never the thing that permits an action: Django decides that.
 */
interface SessionValue {
  user: SessionUser
  business: Business | null
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children, ...value }: SessionValue & { children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside <SessionProvider>")
  return value
}

export function useCurrentUser() {
  return useSession().user
}

/** The business's settings, or sensible defaults for the super admin, who has no business. */
export function useSettings(): BusinessSettings {
  return useSession().business?.settings ?? FALLBACK
}

export function useCurrency() {
  return useSession().business?.settings.currency ?? "BDT"
}

/**
 * The branches this user may act in, and whether to show a branch picker at all.
 *
 * There is no Branches screen: a business is created with exactly one, so `showPicker` is
 * false everywhere and every form quietly uses `defaultBranchId`. The model and these
 * pickers stay as the seam for a second location later — stock, rentals and purchases all
 * already record which branch they happened at, so opening one needs no migration.
 */
export function useBranchScope() {
  const { user, business } = useSession()
  const all = business?.branches ?? []
  const mine = user.role === "owner" || user.role === "manager" || user.branchIds.length === 0
    ? all
    : all.filter((b) => user.branchIds.includes(b.id))
  return {
    branches: mine,
    /** The default for a form: their only branch, or the business's first. */
    defaultBranchId: mine[0]?.id ?? "",
    /** One branch means no picker: the common case should feel like a single shop. */
    showPicker: mine.length > 1,
  }
}

/** Whether to render a link or button for a route. Mirrors the server's own check. */
export function useCanAccess(path: string) {
  const { user, business } = useSession()
  return canAccess(user, path, business?.settings)
}

export function useHasPermission(permission: PermissionId) {
  const { user, business } = useSession()
  return business ? hasPermission(user.role, permission, business.settings) : false
}

const FALLBACK: BusinessSettings = {
  currency: "BDT",
  modules: { rentals: true, sales: false, purchases: true },
  permissions: {
    managerUsers: false,
    managerProducts: false,
    managerCustomers: false,
    managerBranches: false,
    managerActivity: false,
    managerPurchases: false,
    managerProfit: false,
    staffWalkInRentals: false,
    staffCreateProducts: false,
  },
  rentals: { defaultPlan: "daily", lateFeeMultiplier: 1, depositRequired: true, allowOpenEnded: true },
  receiptNote: "",
  lowStockAlert: 5,
}
