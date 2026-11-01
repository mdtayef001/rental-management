"use client"

import { useState } from "react"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatTile, TableSkeleton } from "@/components/common"
import { useCurrency } from "@/components/session"
import { usePaySupplier, useSaveSupplier } from "@/lib/data/mutations"
import { useDebounced, usePaging, useSupplierDebtSummary, useSuppliers } from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import type { Supplier } from "@/lib/types"

/** Who the business buys stock from, and what it still owes each of them. */
export function SuppliersView() {
  const currency = useCurrency()
  const [text, setText] = useState("")
  const [owing, setOwing] = useState(false)
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, owing)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [paying, setPaying] = useState<Supplier | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useSuppliers(
    { page, search, stats: true, owing: owing || undefined },
    { pageSize },
  )
  const { data: debt } = useSupplierDebtSummary()

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" description="Who you buy stock from, and what you still owe.">
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New supplier
        </Button>
      </PageHeader>

      {debt && debt.owed > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Owed in total" value={money(debt.owed, currency)} tone="warning" />
          <StatTile
            label="Past its due date"
            value={money(debt.overdue, currency)}
            tone={debt.overdue ? "danger" : "default"}
          />
          <StatTile label="Suppliers owed" value={count(debt.supplierCount)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, company or phone"
            className="pl-9"
            aria-label="Search suppliers"
          />
        </div>
        <Button size="sm" variant={owing ? "default" : "outline"} onClick={() => setOwing((v) => !v)}>
          Owed money only
        </Button>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nobody matches “${search}”` : "No suppliers yet"}
          description="Add the people you buy stock from to track bills and what you owe."
          action={<Button onClick={() => setAdding(true)}>Add a supplier</Button>}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Bills</TableHead>
                  <TableHead className="text-right">Bought in total</TableHead>
                  <TableHead className="text-right">You owe</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <button type="button" className="font-medium hover:underline" onClick={() => setEditing(supplier)}>
                        {supplier.name}
                      </button>
                      {supplier.company && <div className="text-xs text-muted-foreground">{supplier.company}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{supplier.phone || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {count(supplier.purchaseCount ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(supplier.totalBought ?? 0, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(supplier.balance ?? 0) > 0 ? (
                        <span className="font-medium text-amber-600 dark:text-amber-500">
                          {money(supplier.balance, currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(supplier.balance ?? 0) > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setPaying(supplier)}>
                          Pay
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.count ?? 0}
            onPage={setPage}
            onPageSize={setPageSize}
            busy={isFetching}
          />
        </>
      )}

      {adding && <SupplierDialog onClose={() => setAdding(false)} />}
      {editing && <SupplierDialog supplier={editing} onClose={() => setEditing(null)} />}
      {paying && <PayDialog supplier={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

function SupplierDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const save = useSaveSupplier(supplier?.id)
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    company: supplier?.company ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle>
        </DialogHeader>
        <form
          id="supplier-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(form, { onSuccess: onClose })
          }}
        >
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sup-name">Name</Label>
            <Input id="sup-name" value={form.name} onChange={set("name")} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-company">Company</Label>
            <Input id="sup-company" value={form.company} onChange={set("company")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-phone">Phone</Label>
            <Input id="sup-phone" value={form.phone} onChange={set("phone")} inputMode="tel" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sup-address">Address</Label>
            <Input id="sup-address" value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sup-notes">Notes</Label>
            <Textarea id="sup-notes" value={form.notes} onChange={set("notes")} rows={2} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="supplier-form" disabled={save.isPending || !form.name.trim()}>
            {save.isPending && <Spinner />}
            {supplier ? "Save" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PayDialog({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const currency = useCurrency()
  const pay = usePaySupplier()
  const owed = supplier.balance ?? 0
  const [amount, setAmount] = useState<number | "">(owed)
  const [method, setMethod] = useState("cash")
  const [note, setNote] = useState("")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay {supplier.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You owe {money(owed, currency)}. A payment clears their oldest unpaid bills first.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input
              id="pay-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
              className="tabular-nums"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">How</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="mobile">Mobile banking</option>
              <option value="bank">Bank</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note</Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pay.isPending || !amount}
            onClick={() =>
              pay.mutate({ supplier: supplier.id, amount: Number(amount), method, note }, { onSuccess: onClose })
            }
          >
            {pay.isPending && <Spinner />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
