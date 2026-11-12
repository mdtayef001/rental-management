"use client"

import { useState } from "react"
import { KeyRound, Plus, UserMinus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, TableSkeleton } from "@/components/common"
import { DataView, Primary, type Column } from "@/components/data-view"
import { useBranchScope, useCurrentUser } from "@/components/session"
import { canManageUser, creatableRoles, roleLabel } from "@/lib/auth/roles"
import { useDisableUser, useSaveUser, useSetUserPassword } from "@/lib/data/mutations"
import { usePaging, useUsers } from "@/lib/data/queries"
import { date } from "@/lib/format"
import type { RightId, SessionUser, TenantRole } from "@/lib/types"

/** The per-person rights, in the order they matter at a counter. */
const RIGHTS: { id: RightId; label: string; hint: string }[] = [
  { id: "canRent", label: "Rent items out", hint: "Start a new rental." },
  { id: "canTakeReturns", label: "Take returns", hint: "Accept items back, take the money and give change back." },
  { id: "canAddStock", label: "Change stock", hint: "Correct shelf counts and record damage." },
]

/**
 * The team.
 *
 * Who may do what is decided by the server; this screen only shows what the current user
 * is allowed to change, using the same `canManageUser` rule Django applies. Removing
 * someone disables their account rather than deleting it, so the rentals they handled keep
 * their name against them.
 */
export function UsersView() {
  const me = useCurrentUser()
  const { page, pageSize, setPage, setPageSize } = usePaging()
  const { data, isLoading, isFetching, isError, error, refetch } = useUsers({ page }, { pageSize })
  const [editing, setEditing] = useState<SessionUser | null>(null)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<SessionUser | null>(null)

  const roles = creatableRoles(me)

  const columns: Column<SessionUser>[] = [
    {
      id: "name",
      header: "Name",
      role: "title",
      cell: (person) => (
        <Primary sub={person.email}>
          <span className={person.isActive ? undefined : "line-through decoration-muted-foreground"}>
            {person.name}
          </span>
          {person.id === me.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
        </Primary>
      ),
    },
    {
      id: "role",
      header: "Role",
      role: "status",
      cell: (person) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={person.role === "owner" ? "default" : "secondary"}>{roleLabel(person)}</Badge>
          {!person.isActive && <Badge variant="outline">Disabled</Badge>}
        </div>
      ),
    },
    {
      id: "can",
      header: "Can",
      cell: (person) => (
        <span className="text-sm text-muted-foreground">
          {person.role === "staff"
            ? RIGHTS.filter((r) => person[r.id])
                .map((r) => r.label)
                .join(", ") || "Nothing yet"
            : "Everything in their role"}
        </span>
      ),
    },
    {
      id: "seen",
      header: "Last logged in",
      cell: (person) => (
        <span className="text-sm text-muted-foreground">{person.lastLogin ? date(person.lastLogin) : "Never"}</span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Team" description="Who works here, and what each of them is allowed to do.">
        {roles.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add someone
          </Button>
        )}
      </PageHeader>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState title="Nobody else yet" description="Add a manager or counter staff to share the work." />
      ) : (
        <>
          <DataView
            label="Team"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(person) => person.id}
            actions={(person) =>
              canManageUser(me, person) ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(person)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setResetting(person)}>
                    <KeyRound className="size-4" />
                    <span className="md:sr-only">Reset password</span>
                  </Button>
                </>
              ) : null
            }
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

      {adding && <UserDialog roles={roles} onClose={() => setAdding(false)} />}
      {editing && <UserDialog roles={roles} user={editing} onClose={() => setEditing(null)} />}
      {resetting && <PasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  )
}

function UserDialog({ roles, user, onClose }: { roles: TenantRole[]; user?: SessionUser; onClose: () => void }) {
  const { branches, showPicker } = useBranchScope()
  const save = useSaveUser(user?.id)
  const disable = useDisableUser()
  const [form, setForm] = useState(() => ({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    password: "",
    role: (user?.role ?? roles[roles.length - 1] ?? "staff") as TenantRole,
    branchIds: user?.branchIds ?? [],
    canRent: user?.canRent ?? true,
    canTakeReturns: user?.canTakeReturns ?? true,
    canAddStock: user?.canAddStock ?? false,
  }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Editing never sends an email or a blank password: changing an email would move the
    // account, and a blank password would wipe it.
    const body = user
      ? {
          name: form.name,
          phone: form.phone,
          role: form.role,
          branchIds: form.branchIds,
          canRent: form.canRent,
          canTakeReturns: form.canTakeReturns,
          canAddStock: form.canAddStock,
        }
      : form
    save.mutate(body, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : "Add someone to the team"}</DialogTitle>
          <DialogDescription>
            {user
              ? "Their email can't be changed here — reset the password instead if they're locked out."
              : "They log in with this email and password. Tell them to change it after their first login."}
          </DialogDescription>
        </DialogHeader>

        <form id="user-form" className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u-name">Name</Label>
              <Input
                id="u-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-phone">Phone</Label>
              <Input
                id="u-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                inputMode="tel"
              />
            </div>
            {!user && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="u-email">Email</Label>
                  <Input
                    id="u-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="u-password">Password</Label>
                  <Input
                    id="u-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    minLength={10}
                  />
                  <p className="text-xs text-muted-foreground">At least 10 characters.</p>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="u-role">Role</Label>
              <select
                id="u-role"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as TenantRole }))}
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role === "owner" ? "Admin (owner level)" : role === "manager" ? "Manager" : "Staff"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showPicker && form.role === "staff" && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Branches they work at</legend>
              {branches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.branchIds.includes(branch.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        branchIds: e.target.checked
                          ? [...f.branchIds, branch.id]
                          : f.branchIds.filter((id) => id !== branch.id),
                      }))
                    }
                  />
                  {branch.name}
                </label>
              ))}
            </fieldset>
          )}

          {form.role === "staff" && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">What they can do</legend>
              <p className="text-xs text-muted-foreground">
                Managers and admins can always do all of these. These switches only apply to staff.
              </p>
              {RIGHTS.map((right) => (
                <label key={right.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(form[right.id])}
                    onChange={(e) => setForm((f) => ({ ...f, [right.id]: e.target.checked }))}
                  />
                  <span>
                    {right.label}
                    <span className="block text-xs text-muted-foreground">{right.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </form>

        <DialogFooter className="flex-wrap gap-2">
          {user?.isActive && (
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={disable.isPending}
              onClick={() => disable.mutate(user.id, { onSuccess: onClose })}
            >
              <UserMinus className="size-4" />
              Disable account
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {user ? "Save" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const set = useSetUserPassword()
  const [password, setPassword] = useState("")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset {user.name}&apos;s password</DialogTitle>
          <DialogDescription>They will need the new password to log in. Tell it to them directly.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={10}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={set.isPending || password.length < 10}
            onClick={() => set.mutate({ id: user.id, password }, { onSuccess: onClose })}
          >
            {set.isPending && <Spinner />}
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
