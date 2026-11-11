"use client"

import { useState } from "react"
import { Ban, KeyRound, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { DataView, Primary, type Column } from "@/components/data-view"
import {
  useCreateBusiness,
  useDeleteBusiness,
  useResetOwnerPassword,
  useSuspendBusiness,
} from "@/lib/data/mutations"
import { useDebounced, usePaging, usePlatformBusinesses } from "@/lib/data/queries"
import { count, date } from "@/lib/format"
import type { PlatformBusiness } from "@/lib/types"

const STATUSES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const

/**
 * The super admin's only screen: the businesses on the platform.
 *
 * They can create one with its owner, switch it off, reset the owner's password when
 * somebody is locked out, and delete it. They cannot look inside one — there is no
 * endpoint that would let them, by design.
 */
export function PlatformView() {
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, status)
  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState<{ business: PlatformBusiness; what: "password" | "delete" } | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = usePlatformBusinesses(
    { page, search, status },
    { pageSize },
  )
  const suspend = useSuspendBusiness()

  const columns: Column<PlatformBusiness>[] = [
    {
      id: "business",
      header: "Business",
      role: "title",
      cell: (business) => (
        <Primary
          sub={
            <>
              {business.industry || "No industry"}
              {business.suspended && business.suspendedReason && (
                <span className="block text-destructive">{business.suspendedReason}</span>
              )}
            </>
          }
        >
          {business.name}
        </Primary>
      ),
    },
    {
      id: "state",
      header: "",
      role: "status",
      cell: (business) => (business.suspended ? <Badge variant="destructive">Suspended</Badge> : null),
    },
    {
      id: "owner",
      header: "Owner",
      cell: (business) => (
        <>
          {business.ownerName}
          <div className="text-xs text-muted-foreground">{business.ownerEmail}</div>
        </>
      ),
    },
    { id: "people", header: "People", align: "end", cell: (business) => count(business.userCount) },
    {
      id: "created",
      header: "Created",
      cell: (business) => <span className="text-muted-foreground">{date(business.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Businesses" description="Every business on the platform.">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New business
        </Button>
      </PageHeader>

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder="Business name or owner email"
          label="Search businesses"
          suggest="businesses"
        />
        <FilterTabs value={status} onChange={setStatus} options={STATUSES} label="Filter businesses" />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "No businesses yet"}
          description="Create one, and its owner can start setting up their shop."
          action={<Button onClick={() => setCreating(true)}>Create a business</Button>}
        />
      ) : (
        <>
          <DataView
            label="Businesses"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(business) => business.id}
            actions={(business) => (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={suspend.isPending}
                  onClick={() =>
                    suspend.mutate({
                      id: business.id,
                      suspended: !business.suspended,
                      reason: business.suspended ? "" : "Suspended by the platform administrator",
                    })
                  }
                >
                  <Ban className="size-4" />
                  {business.suspended ? "Switch on" : "Suspend"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setActing({ business, what: "password" })}>
                  <KeyRound className="size-4" />
                  <span className="md:sr-only">Reset owner password</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setActing({ business, what: "delete" })}>
                  <Trash2 className="size-4" />
                  <span className="md:sr-only">Delete</span>
                </Button>
              </>
            )}
          />

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

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {acting?.what === "password" && (
        <OwnerPasswordDialog business={acting.business} onClose={() => setActing(null)} />
      )}
      {acting?.what === "delete" && <DeleteDialog business={acting.business} onClose={() => setActing(null)} />}
    </div>
  )
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateBusiness()
  const [form, setForm] = useState({
    name: "",
    industry: "",
    phone: "",
    address: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New business</DialogTitle>
          <DialogDescription>
            This creates the business, its first branch and the owner&apos;s login together. Give the owner their
            password directly.
          </DialogDescription>
        </DialogHeader>

        <form
          id="business-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(form, { onSuccess: onClose })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-name">Business name</Label>
              <Input id="b-name" value={form.name} onChange={set("name")} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-industry">Industry</Label>
              <Input id="b-industry" value={form.industry} onChange={set("industry")} placeholder="Equipment rental" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-phone">Phone</Label>
              <Input id="b-phone" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-address">Address</Label>
              <Input id="b-address" value={form.address} onChange={set("address")} />
            </div>
          </div>

          <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">The owner&apos;s account</legend>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-owner">Their name</Label>
              <Input id="b-owner" value={form.ownerName} onChange={set("ownerName")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-email">Email</Label>
              <Input id="b-email" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-password">Password</Label>
              <Input
                id="b-password"
                type="password"
                value={form.ownerPassword}
                onChange={set("ownerPassword")}
                required
                minLength={10}
              />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="business-form" disabled={create.isPending}>
            {create.isPending && <Spinner />}
            Create business
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OwnerPasswordDialog({ business, onClose }: { business: PlatformBusiness; onClose: () => void }) {
  const reset = useResetOwnerPassword()
  const [password, setPassword] = useState("")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset the owner password</DialogTitle>
          <DialogDescription>
            For {business.ownerEmail} at {business.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="owner-password">New password</Label>
          <Input
            id="owner-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={10}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reset.isPending || password.length < 10}
            onClick={() => reset.mutate({ id: business.id, password }, { onSuccess: onClose })}
          >
            {reset.isPending && <Spinner />}
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Deleting a business takes every rental, customer and record with it, so the name has to
 * be typed back exactly. The server requires this too — it is not only a UI guard.
 */
function DeleteDialog({ business, onClose }: { business: PlatformBusiness; onClose: () => void }) {
  const remove = useDeleteBusiness()
  const [typed, setTyped] = useState("")
  const matches = typed.trim() === business.name

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {business.name}?</DialogTitle>
          <DialogDescription>
            Everything in it goes — every rental, customer, product and record, for all{" "}
            {count(business.userCount)} people. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-name">
            Type <span className="font-medium">{business.name}</span> to confirm
          </Label>
          <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || !matches}
            onClick={() => remove.mutate({ id: business.id, confirmName: typed.trim() }, { onSuccess: onClose })}
          >
            {remove.isPending && <Spinner />}
            Delete for good
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
