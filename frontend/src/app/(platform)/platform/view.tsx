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
import { msg, t } from "@/lib/i18n"

const STATUSES = [
  { value: "", label: msg("All") },
  { value: "active", label: msg("Active") },
  { value: "suspended", label: msg("Suspended") },
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
      header: t("Business"),
      role: "title",
      cell: (business) => (
        <Primary
          sub={
            <>
              {business.industry || t("No industry")}
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
      cell: (business) => (business.suspended ? <Badge variant="destructive">{t("Suspended")}</Badge> : null),
    },
    {
      id: "owner",
      header: t("Owner"),
      cell: (business) => (
        <>
          {business.ownerName}
          <div className="text-xs text-muted-foreground">{business.ownerEmail}</div>
        </>
      ),
    },
    { id: "people", header: t("People"), align: "end", cell: (business) => count(business.userCount) },
    {
      id: "created",
      header: t("Created"),
      cell: (business) => <span className="text-muted-foreground">{date(business.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title={t("Businesses")} description={t("Every business on the platform.")}>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {t("New business")}
        </Button>
      </PageHeader>

      <Toolbar>
        <SearchInput
          value={text}
          onChange={setText}
          placeholder={t("Business name or owner email")}
          label={t("Search businesses")}
          suggest="businesses"
        />
        <FilterTabs value={status} onChange={setStatus} options={STATUSES} label={t("Filter businesses")} />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? t("Nothing matches “{search}”", { search }) : t("No businesses yet")}
          description={t("Create one, and its owner can start setting up their shop.")}
          action={<Button onClick={() => setCreating(true)}>{t("Create a business")}</Button>}
        />
      ) : (
        <>
          <DataView
            label={t("Businesses")}
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
                      reason: business.suspended ? "" : t("Suspended by the platform administrator"),
                    })
                  }
                >
                  <Ban className="size-4" />
                  {business.suspended ? t("Switch on") : t("Suspend")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setActing({ business, what: "password" })}>
                  <KeyRound className="size-4" />
                  <span className="md:sr-only">{t("Reset owner password")}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setActing({ business, what: "delete" })}>
                  <Trash2 className="size-4" />
                  <span className="md:sr-only">{t("Delete")}</span>
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
          <DialogTitle>{t("New business")}</DialogTitle>
          <DialogDescription>
            {t("This creates the business and the owner's login together. Give the owner their password directly.")}
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
              <Label htmlFor="b-name">{t("Business name")}</Label>
              <Input id="b-name" value={form.name} onChange={set("name")} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-industry">{t("Industry")}</Label>
              <Input id="b-industry" value={form.industry} onChange={set("industry")} placeholder={t("Equipment rental")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-phone">{t("Phone")}</Label>
              <Input id="b-phone" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-address">{t("Address")}</Label>
              <Input id="b-address" value={form.address} onChange={set("address")} />
            </div>
          </div>

          <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t("The owner's account")}</legend>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-owner">{t("Their name")}</Label>
              <Input id="b-owner" value={form.ownerName} onChange={set("ownerName")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-email">{t("Email")}</Label>
              <Input id="b-email" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-password">{t("Password")}</Label>
              <Input
                id="b-password"
                type="password"
                value={form.ownerPassword}
                onChange={set("ownerPassword")}
                required
                minLength={10}
              />
              <p className="text-xs text-muted-foreground">{t("At least 10 characters.")}</p>
            </div>
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form="business-form" disabled={create.isPending}>
            {create.isPending && <Spinner />}
            {t("Create business")}
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
          <DialogTitle>{t("Reset the owner password")}</DialogTitle>
          <DialogDescription>
            {t("For {email} at {business}.", { email: business.ownerEmail, business: business.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="owner-password">{t("New password")}</Label>
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
            {t("Cancel")}
          </Button>
          <Button
            disabled={reset.isPending || password.length < 10}
            onClick={() => reset.mutate({ id: business.id, password }, { onSuccess: onClose })}
          >
            {reset.isPending && <Spinner />}
            {t("Set password")}
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
          <DialogTitle>{t("Delete {name}?", { name: business.name })}</DialogTitle>
          <DialogDescription>
            {t("Everything in it goes — every rental, customer, product and record, for all {count} people. This cannot be undone.", {
              count: count(business.userCount),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-name">
            {t("Type {name} to confirm", { name: business.name })}
          </Label>
          <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Keep it")}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || !matches}
            onClick={() => remove.mutate({ id: business.id, confirmName: typed.trim() }, { onSuccess: onClose })}
          >
            {remove.isPending && <Spinner />}
            {t("Delete for good")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
