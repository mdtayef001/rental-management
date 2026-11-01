"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api/client"
import type {
  Activity,
  Branch,
  Customer,
  PlatformBusiness,
  Product,
  ProductLookup,
  Purchase,
  Rental,
  RentalReturn,
  RentalSummary,
  SessionUser,
  StockLevel,
  StockMovement,
  Supplier,
  SupplierPayment,
  SupplierReturn,
  CustomerReportRow,
  Page,
  ProductReportRow,
  ReportExport,
  ReportGroup,
  ReportRange,
  ReportSummary,
  RevenueRow,
} from "@/lib/types"

// Reads from the Django API, cached by TanStack Query.
//
// Three rules keep this fast on a shop with tens of thousands of rows:
//   1. Lists come one page at a time, and are searched and filtered by the server.
//   2. Nothing fetches on mount that the screen isn't showing — `enabled` guards the rest.
//   3. Keys start with the API collection, so a write can refresh exactly what it touched
//      (see use-mutations.ts) instead of emptying the whole cache.

export type Params = Record<string, string | number | boolean | string[] | null | undefined>

/** `("products/", { search: "tv", inStock: true })` → `"products/?search=tv&in_stock=1"`. */
export function withParams(path: string, params: Params = {}) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    // Empty values are left out entirely, so a cleared filter doesn't send `?search=`.
    if (value === undefined || value === null || value === "" || value === false) continue
    const key = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v === true ? "1" : String(v))
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/** A query whose key starts with the collection name, so writes can invalidate by collection. */
export function apiQuery<T>(path: string, params: Params = {}) {
  return queryOptions({
    queryKey: [path.split("/")[0], path, params] as const,
    queryFn: ({ signal }) => request<T>(withParams(path, params), { signal }),
  })
}

/** Rows per page people can choose. The first is the default. */
export const PAGE_SIZES = [10, 25, 50, 100]
const PAGE_SIZE_KEY = "rm.pageSize"

/** One page of a list. The previous page stays on screen while the next one loads. */
export function usePage<T>(
  path: string,
  params: Params & { page: number },
  { pageSize = PAGE_SIZES[1], enabled = true } = {},
) {
  return useQuery({
    ...apiQuery<Page<T>>(path, { ...params, pageSize }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Page number and rows per page, resetting to page 1 whenever the filters change. */
export function usePaging(...filters: unknown[]) {
  const [pageSize, setSize] = useState(savedPageSize)
  const key = JSON.stringify([pageSize, ...filters])
  const [state, setState] = useState({ key, page: 1 })
  const page = state.key === key ? state.page : 1

  function setPageSize(size: number) {
    setSize(size)
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size))
    } catch {
      // Private window or storage blocked: the choice just isn't remembered.
    }
  }
  return { page, pageSize, setPage: (next: number) => setState({ key, page: next }), setPageSize }
}

function savedPageSize() {
  try {
    const size = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return PAGE_SIZES.includes(size) ? size : PAGE_SIZES[1]
  } catch {
    return PAGE_SIZES[1]
  }
}

/** The value after it stopped changing for a moment, so typing doesn't send one request per key. */
export function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** A list's search box, filled from `?q=` so another screen can link straight to a match. */
export function useLinkedSearch(onLink?: (q: string) => void) {
  const linked = useSearchParams().get("q") ?? ""
  const [query, setQuery] = useState(linked)
  const [seen, setSeen] = useState(linked)
  if (linked !== seen) {
    setSeen(linked)
    setQuery(linked)
    onLink?.(linked)
  }
  return [query, setQuery] as const
}

// ---------- Small lists, cached longer ----------

const EMPTY: never[] = []

/** Every branch in the business. Few, and needed on nearly every screen. */
export const branchesQuery = { ...apiQuery<Branch[]>("branches/"), staleTime: 5 * 60_000 }

export function useBranches() {
  return useQuery(branchesQuery).data ?? (EMPTY as Branch[])
}

export function useCategories() {
  return useQuery({ ...apiQuery<string[]>("products/categories/"), staleTime: 5 * 60_000 }).data ?? (EMPTY as string[])
}

export function useActivityPeople(enabled = true) {
  return useQuery({ ...apiQuery<{ id: string; name: string }[]>("activity/people/"), enabled }).data ?? EMPTY
}

// ---------- Scanning ----------

/**
 * Looks up one scanned or typed code.
 *
 * Cached for a minute so scanning the same item twice in a row is instant, and `retry:
 * false` because an unknown code is an answer, not a failure worth retrying.
 */
export function useLookup(code: string, { rentableOnly = false, enabled = true } = {}) {
  return useQuery({
    ...apiQuery<ProductLookup>("products/lookup/", { code, rentableOnly }),
    enabled: enabled && code.trim().length > 0,
    staleTime: 60_000,
    retry: false,
  })
}

/** Name / SKU / barcode search, for when a code won't scan. */
export function useProductSearch(text: string, { rentableOnly = false, enabled = true } = {}) {
  const settled = useDebounced(text.trim(), 250)
  return useQuery({
    ...apiQuery<ProductLookup[]>("products/lookup/", { search: settled, rentableOnly }),
    enabled: enabled && settled.length > 1,
    staleTime: 30_000,
  })
}

// ---------- Single records ----------

export function useProduct(id: string | null | undefined) {
  return useQuery({ ...apiQuery<Product>(`products/${id}/`), enabled: !!id })
}

export function useRental(id: string | null | undefined) {
  return useQuery({ ...apiQuery<Rental>(`rentals/${id}/`), enabled: !!id })
}

export function useCustomer(id: string | null | undefined) {
  return useQuery({ ...apiQuery<Customer>(`customers/${id}/`), enabled: !!id })
}

export function useSupplier(id: string | null | undefined) {
  return useQuery({ ...apiQuery<Supplier>(`suppliers/${id}/`), enabled: !!id })
}

/** Stock of a product at a branch, from a product loaded with its stock map. */
export function qtyAt(product: Pick<Product, "stock"> | Pick<ProductLookup, "stock"> | null | undefined, branchId: string | null | undefined) {
  return (branchId && product?.stock?.[branchId]) || 0
}

// ---------- Totals ----------

/** The dashboard tiles and sidebar badges. Rechecked every minute: other people change them too. */
export function useRentalSummary({ enabled = true, live = false } = {}) {
  return useQuery({
    ...apiQuery<RentalSummary>("rentals/summary/"),
    enabled,
    refetchInterval: live ? 60_000 : false,
  })
}

export function useStockSummary(params: Params = {}, enabled = true) {
  return useQuery({
    ...apiQuery<{ units: number; lines: number; lowStock: number }>("stock/summary/", params),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function usePurchaseSummary(params: Params = {}, enabled = true) {
  return useQuery({
    ...apiQuery<{ count: number; total: number; due: number }>("purchases/summary/", params),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useSupplierDebtSummary(enabled = true) {
  return useQuery({
    ...apiQuery<{ owed: number; overdue: number; supplierCount: number }>("purchases/payments-summary/"),
    enabled,
  })
}

// ---------- Lists ----------
// Typed shortcuts, so a page reads as `useRentals({ page, status: "overdue" })`.

type ListOptions = { pageSize?: number; enabled?: boolean }

export const useProducts = (params: Params & { page: number }, o?: ListOptions) => usePage<Product>("products/", params, o)
export const useCustomers = (params: Params & { page: number }, o?: ListOptions) => usePage<Customer>("customers/", params, o)
export const useRentals = (params: Params & { page: number }, o?: ListOptions) => usePage<Rental>("rentals/", params, o)
export const useReturns = (params: Params & { page: number }, o?: ListOptions) => usePage<RentalReturn>("returns/", params, o)
export const useStock = (params: Params & { page: number }, o?: ListOptions) => usePage<StockLevel>("stock/", params, o)
export const useStockMovements = (params: Params & { page: number }, o?: ListOptions) =>
  usePage<StockMovement>("stock/movements/", params, o)
export const useSuppliers = (params: Params & { page: number }, o?: ListOptions) => usePage<Supplier>("suppliers/", params, o)
export const usePurchases = (params: Params & { page: number }, o?: ListOptions) => usePage<Purchase>("purchases/", params, o)
export const useSupplierReturns = (params: Params & { page: number }, o?: ListOptions) =>
  usePage<SupplierReturn>("purchases/returns-list/", params, o)
export const useSupplierPayments = (params: Params & { page: number }, o?: ListOptions) =>
  usePage<SupplierPayment>("purchases/payments/", params, o)
export const useActivity = (params: Params & { page: number }, o?: ListOptions) => usePage<Activity>("activity/", params, o)
export const useUsers = (params: Params & { page: number }, o?: ListOptions) => usePage<SessionUser>("users/", params, o)
export const usePlatformBusinesses = (params: Params & { page: number }, o?: ListOptions) =>
  usePage<PlatformBusiness>("platform/businesses/", params, o)

// ---------- Reports ----------

/**
 * One report over a date range.
 *
 * Reports are read far more often than the data behind them changes within a session, and
 * each one is a handful of aggregates, so they are cached for a minute and the previous
 * range stays on screen while a new one loads — changing the dates shouldn't blank the page.
 */
function reportQuery<T>(name: string, params: Params, enabled: boolean) {
  return {
    ...apiQuery<T>(`reports/${name}/`, params),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  }
}

export function useReportSummary(range: ReportRange, enabled = true) {
  return useQuery(reportQuery<ReportSummary>("summary", { ...range }, enabled))
}

export function useRevenueReport(range: ReportRange, group: ReportGroup | "" = "", enabled = true) {
  return useQuery(
    reportQuery<ReportRange & { group: ReportGroup; results: RevenueRow[] }>("revenue", { ...range, group }, enabled),
  )
}

export function useProductReport(range: ReportRange, enabled = true) {
  return useQuery(reportQuery<ReportRange & { results: ProductReportRow[] }>("products", { ...range }, enabled))
}

export function useCustomerReport(range: ReportRange, enabled = true) {
  return useQuery(reportQuery<ReportRange & { results: CustomerReportRow[] }>("customers", { ...range }, enabled))
}

/**
 * The href that downloads a report as CSV.
 *
 * A plain link, not a fetch: the login token travels in an httpOnly cookie, which the
 * browser sends on a navigation of its own accord, and the file streams to disk without
 * ever being held in the page's memory.
 */
export function exportUrl(report: ReportExport, range: ReportRange, group: ReportGroup | "" = "") {
  // No trailing slash: Next redirects one away (308) and the route handler puts it back
  // before calling Django, so writing it here only costs the browser a round trip.
  return `/api/backend/${withParams("reports/export", { report, ...range, group })}`
}
