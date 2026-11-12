"use client"

import { useState } from "react"
import { Plus, Search, User, UserX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/common"
import { useSaveCustomer } from "@/lib/data/mutations"
import { useCustomers, useDebounced } from "@/lib/data/queries"
import { plural } from "@/lib/format"
import type { Customer } from "@/lib/types"

/**
 * Pick the customer, or add them on the spot.
 *
 * Staff at a counter shouldn't have to leave the rental to create a customer, so adding
 * one happens in a dialog and the new customer is selected straight away. Blocked
 * customers are shown but can't be chosen — with the reason, so staff can explain it.
 */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: Customer | null
  onChange: (customer: Customer | null) => void
}) {
  const [text, setText] = useState("")
  const search = useDebounced(text.trim(), 250)
  const [adding, setAdding] = useState(false)

  const { data, isFetching } = useCustomers(
    { page: 1, search, stats: true },
    { pageSize: 8, enabled: search.length > 0 },
  )

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <User className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{value.name}</span>
            {(value.openRentalCount ?? 0) > 0 && (
              <Badge variant="secondary">{plural(value.openRentalCount ?? 0, "rental")} out</Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {[value.phone, value.company].filter(Boolean).join(" · ") || "No contact details"}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Customer name or phone number"
            className="h-10 pl-9"
            aria-label="Search customers"
          />
        </div>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New
        </Button>
      </div>

      {search.length > 0 && (
        <>
          {isFetching && !data && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Searching…
            </div>
          )}
          {data && data.results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nobody matches “{search}”.{" "}
              <button type="button" className="underline" onClick={() => setAdding(true)}>
                Add them
              </button>
              ?
            </p>
          )}
          {data && data.results.length > 0 && (
            <ul className="divide-y rounded-md border">
              {data.results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    disabled={customer.blocked}
                    onClick={() => onChange(customer)}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{customer.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {[customer.phone, customer.company].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {customer.blocked && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                          <UserX className="size-3" />
                          Blocked{customer.blockedReason ? `: ${customer.blockedReason}` : ""}
                        </div>
                      )}
                    </div>
                    {(customer.openRentalCount ?? 0) > 0 && (
                      <Badge variant="secondary" className="shrink-0">
                        {customer.openRentalCount} out
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <CustomerDialog
        open={adding}
        onOpenChange={setAdding}
        initialName={search}
        onSaved={(customer) => {
          onChange(customer)
          setAdding(false)
          setText("")
        }}
      />
    </div>
  )
}

/** Add or edit a customer. Used from the rental screen and the customers list. */
export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  initialName = "",
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer?: Customer
  initialName?: string
  onSaved?: (customer: Customer) => void
}) {
  const save = useSaveCustomer(customer?.id)
  const [form, setForm] = useState(() => ({
    name: customer?.name ?? initialName,
    phone: customer?.phone ?? "",
    company: customer?.company ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    idType: customer?.idType ?? "NID",
    idNumber: customer?.idNumber ?? "",
    notes: customer?.notes ?? "",
  }))

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.name}` : "New customer"}</DialogTitle>
          <DialogDescription>
            Only the name is required. An ID reference is worth taking for anything valuable.
          </DialogDescription>
        </DialogHeader>

        <form
          id="customer-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(form, { onSuccess: (saved) => (onSaved ? onSaved(saved) : onOpenChange(false)) })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" value={form.name} onChange={set("name")} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="01XXXXXXXXX" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-company">Company</Label>
              <Input id="c-company" value={form.company} onChange={set("company")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-id-type">ID type</Label>
              <Input id="c-id-type" value={form.idType} onChange={set("idType")} placeholder="NID, passport…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-id-number">ID number</Label>
              <Input id="c-id-number" value={form.idNumber} onChange={set("idNumber")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-address">Address</Label>
              <Input id="c-address" value={form.address} onChange={set("address")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" value={form.notes} onChange={set("notes")} rows={2} />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" disabled={save.isPending || !form.name.trim()}>
            {save.isPending && <Spinner />}
            {customer ? "Save" : "Add customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
