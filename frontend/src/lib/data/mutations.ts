"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { Customer, Product, Rental, RentalReturn, ResolveReturnResult } from "@/lib/types"

// Writes, and what each one refreshes.
//
// Every mutation names the collections it affects and nothing else. Renting something out
// changes rentals *and* stock *and* the dashboard totals, so all three are refreshed; it
// doesn't touch suppliers, so those stay cached. Invalidating by collection keeps screens
// honest without throwing away a cache the user is about to need.

/** Collections, as the first element of every query key in queries.ts. */
type Collection =
  | "products"
  | "stock"
  | "customers"
  | "rentals"
  | "returns"
  | "branches"
  | "suppliers"
  | "purchases"
  | "users"
  | "activity"
  | "platform"

function useRefresh() {
  const client = useQueryClient()
  return (...collections: Collection[]) => {
    for (const collection of collections) {
      client.invalidateQueries({ queryKey: [collection] })
    }
  }
}

/** Turns an ApiError into a toast. Anything else rethrows, so real bugs aren't swallowed. */
function showError(err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    toast.error(err.message)
    return
  }
  toast.error(fallback)
  throw err
}

// ---------- Rentals ----------

export interface RentalLineInput {
  product: string
  quantity: number
  plan: string
  rate?: number | null
  deposit?: number | null
  replacementCost?: number | null
  holidays?: number
  note?: string
}

export interface RentalInput {
  customer: string | null
  branch: string
  lines: RentalLineInput[]
  startedAt?: string | null
  dueAt?: string | null
  deposit?: number
  paidAmount?: number
  paymentMethod?: string
  paymentReference?: string
  notes?: string
}

/** Rent items out. One call, one rental, one receipt. */
export function useRentOut() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: RentalInput) => request<Rental>("rentals/", { method: "POST", body: input }),
    onSuccess: (rental) => {
      // Stock moved, so the product and stock screens are stale as well as the rental list.
      refresh("rentals", "products", "stock", "customers", "activity")
      toast.success(`${rental.code} rented out`)
    },
    onError: (err) => showError(err, "Couldn't save the rental."),
  })
}

/**
 * "What is this person bringing back?"
 *
 * A mutation rather than a query because it's an action with a body, not a cacheable read —
 * and because the same code scanned twice must ask the server again, since another till may
 * have taken the items back in between.
 */
export function useResolveReturn() {
  return useMutation({
    mutationFn: (input: { code?: string; customer?: string; rental?: string }) =>
      request<ResolveReturnResult>("rentals/resolve-return/", { method: "POST", body: input }),
    onError: (err) => showError(err, "Couldn't look that up."),
  })
}

export interface ReturnLineInput {
  item: string
  quantity: number
  condition?: "good" | "damaged" | "lost"
  holidays?: number | null
  note?: string
}

export interface ReturnInput {
  rentalId: string
  lines: ReturnLineInput[]
  at?: string | null
  discount?: number
  paidAmount?: number
  depositRefunded?: number
  paymentMethod?: string
  paymentReference?: string
  note?: string
}

/** Take some or all of a rental's items back. */
export function useTakeReturn() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ rentalId, ...body }: ReturnInput) =>
      request<{ return: RentalReturn; rental: Rental }>(`rentals/${rentalId}/return/`, { method: "POST", body }),
    onSuccess: ({ return: taken }) => {
      refresh("rentals", "returns", "products", "stock", "customers", "activity")
      toast.success(`${taken.code} recorded`)
    },
    onError: (err) => showError(err, "Couldn't record the return."),
  })
}

export function useRentalPayment() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ rentalId, ...body }: { rentalId: string; amount: number; method?: string; reference?: string; note?: string }) =>
      request<Rental>(`rentals/${rentalId}/payment/`, { method: "POST", body }),
    onSuccess: () => {
      refresh("rentals", "customers", "activity")
      toast.success("Payment recorded")
    },
    onError: (err) => showError(err, "Couldn't record the payment."),
  })
}

export function useRefundDeposit() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ rentalId, ...body }: { rentalId: string; amount: number; method?: string; note?: string }) =>
      request<Rental>(`rentals/${rentalId}/refund-deposit/`, { method: "POST", body }),
    onSuccess: () => {
      refresh("rentals", "customers", "activity")
      toast.success("Deposit returned")
    },
    onError: (err) => showError(err, "Couldn't return the deposit."),
  })
}

export function useCancelRental() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ rentalId, reason }: { rentalId: string; reason?: string }) =>
      request<Rental>(`rentals/${rentalId}/cancel/`, { method: "POST", body: { reason } }),
    onSuccess: (rental) => {
      refresh("rentals", "products", "stock", "activity")
      toast.success(`${rental.code} cancelled and the stock put back`)
    },
    onError: (err) => showError(err, "Couldn't cancel the rental."),
  })
}

// ---------- Catalogue ----------

export function useSaveProduct(id?: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Product>(id ? `products/${id}/` : "products/", { method: id ? "PATCH" : "POST", body }),
    onSuccess: (product) => {
      refresh("products", "stock", "activity")
      toast.success(id ? `${product.name} saved` : `${product.name} added`)
    },
    onError: (err) => showError(err, "Couldn't save the product."),
  })
}

/**
 * Delete a product.
 *
 * Django removes it outright when nothing has ever used it and archives it when something
 * has, because deleting a product with history would be deleting the history. Either way
 * past rentals, receipts and bills keep the name and SKU they were printed with.
 */
export function useDeleteProduct() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => request<void>(`products/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      refresh("products", "stock", "activity")
      toast.success("Product deleted")
    },
    onError: (err) => showError(err, "Couldn't delete the product."),
  })
}

export function useAdjustStock() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { product: string; branch: string; quantity: number; reason: string; note?: string }) =>
      request("stock/adjust/", { method: "POST", body }),
    onSuccess: () => {
      refresh("stock", "products", "activity")
      toast.success("Stock updated")
    },
    onError: (err) => showError(err, "Couldn't update the stock."),
  })
}

export function useSaveCustomer(id?: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Customer>(id ? `customers/${id}/` : "customers/", { method: id ? "PATCH" : "POST", body }),
    onSuccess: (customer) => {
      refresh("customers", "activity")
      toast.success(id ? `${customer.name} saved` : `${customer.name} added`)
    },
    onError: (err) => showError(err, "Couldn't save the customer."),
  })
}

export function useDeleteCustomer() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => request<void>(`customers/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      refresh("customers", "activity")
      toast.success("Customer removed")
    },
    onError: (err) => showError(err, "Couldn't remove the customer."),
  })
}

// ---------- The team ----------

export function useSaveUser(id?: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(id ? `users/${id}/` : "users/", { method: id ? "PATCH" : "POST", body }),
    onSuccess: () => {
      refresh("users", "activity")
      toast.success(id ? "Account saved" : "Account created")
    },
    onError: (err) => showError(err, "Couldn't save the account."),
  })
}

export function useDisableUser() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => request<void>(`users/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      refresh("users", "activity")
      toast.success("Account disabled")
    },
    onError: (err) => showError(err, "Couldn't disable the account."),
  })
}

export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      request<void>(`users/${id}/password/`, { method: "POST", body: { password } }),
    onSuccess: () => toast.success("Password changed"),
    onError: (err) => showError(err, "Couldn't change the password."),
  })
}

// ---------- Purchasing ----------

export function useCreatePurchase() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => request("purchases/", { method: "POST", body }),
    onSuccess: () => {
      // A purchase raises stock and re-averages the product's cost.
      refresh("purchases", "products", "stock", "suppliers", "activity")
      toast.success("Purchase recorded")
    },
    onError: (err) => showError(err, "Couldn't record the purchase."),
  })
}

export function useSaveSupplier(id?: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(id ? `suppliers/${id}/` : "suppliers/", { method: id ? "PATCH" : "POST", body }),
    onSuccess: () => {
      refresh("suppliers", "activity")
      toast.success(id ? "Supplier saved" : "Supplier added")
    },
    onError: (err) => showError(err, "Couldn't save the supplier."),
  })
}

export function usePaySupplier() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { supplier: string; amount: number; method?: string; purchase?: string | null; note?: string }) =>
      request("purchases/payments/", { method: "POST", body }),
    onSuccess: () => {
      refresh("purchases", "suppliers", "activity")
      toast.success("Payment recorded")
    },
    onError: (err) => showError(err, "Couldn't record the payment."),
  })
}

export function useCreateSupplierReturn() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { item: string; quantity: number; reason: string }) =>
      request("purchases/returns/", { method: "POST", body }),
    onSuccess: () => {
      refresh("purchases", "products", "stock", "suppliers", "activity")
      toast.success("Return to supplier recorded")
    },
    onError: (err) => showError(err, "Couldn't record the return."),
  })
}

export function useSettleSupplierReturn() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; replacedQuantity?: number; refundedAmount?: number; creditedAmount?: number; closeNote?: string }) =>
      request(`purchases/returns/${id}/settle/`, { method: "POST", body }),
    onSuccess: () => {
      refresh("purchases", "products", "stock", "suppliers", "activity")
      toast.success("Return settled")
    },
    onError: (err) => showError(err, "Couldn't settle the return."),
  })
}

// ---------- Platform (super admin) ----------

export function useCreateBusiness() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: {
      name: string
      industry?: string
      phone?: string
      address?: string
      ownerName: string
      ownerEmail: string
      ownerPassword: string
    }) => request("platform/businesses/", { method: "POST", body }),
    onSuccess: () => {
      refresh("platform")
      toast.success("Business created with its owner account")
    },
    onError: (err) => showError(err, "Couldn't create the business."),
  })
}

export function useSuspendBusiness() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, suspended, reason }: { id: string; suspended: boolean; reason?: string }) =>
      request(`platform/businesses/${id}/suspend/`, { method: "POST", body: { suspended, reason } }),
    onSuccess: (_data, { suspended }) => {
      refresh("platform")
      toast.success(suspended ? "Business suspended" : "Business switched back on")
    },
    onError: (err) => showError(err, "Couldn't change the business."),
  })
}

export function useResetOwnerPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      request<void>(`platform/businesses/${id}/owner-password/`, { method: "POST", body: { password } }),
    onSuccess: () => toast.success("Owner password reset"),
    onError: (err) => showError(err, "Couldn't reset the password."),
  })
}

export function useDeleteBusiness() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      request<void>(`platform/businesses/${id}/`, { method: "DELETE", body: { confirmName } }),
    onSuccess: () => {
      refresh("platform")
      toast.success("Business deleted")
    },
    onError: (err) => showError(err, "Couldn't delete the business."),
  })
}
