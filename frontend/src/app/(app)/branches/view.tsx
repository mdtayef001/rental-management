"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader, Spinner } from "@/components/common"
import { useSession } from "@/components/session"
import { useSaveBranch } from "@/lib/data/mutations"
import type { Branch } from "@/lib/types"

/**
 * Branches.
 *
 * Most businesses here will only ever have the one they were set up with, and the rest of
 * the app hides the branch picker while that is true. This screen exists so opening a
 * second shop is a two-minute job rather than a support request.
 */
export function BranchesView() {
  const { business } = useSession()
  const branches = business?.branches ?? []
  const [editing, setEditing] = useState<Branch | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description={
          branches.length === 1
            ? "You have one branch, so the app keeps the branch picker out of the way. Add a second and it appears."
            : "Stock, rentals and staff are all kept per branch."
        }
      >
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add a branch
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        {branches.map((branch) => (
          <Card key={branch.id}>
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium">{branch.name}</div>
                {branch.address && <div className="text-sm text-muted-foreground">{branch.address}</div>}
                {branch.phone && <div className="text-sm text-muted-foreground">{branch.phone}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(branch)}>
                Edit
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {adding && <BranchDialog onClose={() => setAdding(false)} />}
      {editing && <BranchDialog branch={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function BranchDialog({ branch, onClose }: { branch?: Branch; onClose: () => void }) {
  const save = useSaveBranch(branch?.id)
  const [form, setForm] = useState({
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
          <DialogDescription>A branch is somewhere stock sits and rentals go out from.</DialogDescription>
        </DialogHeader>
        <form
          id="branch-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(form, { onSuccess: onClose })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="b-name">Name</Label>
            <Input
              id="b-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              autoFocus
              placeholder="Motijheel shop"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-address">Address</Label>
            <Input
              id="b-address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-phone">Phone</Label>
            <Input
              id="b-phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              inputMode="tel"
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="branch-form" disabled={save.isPending || !form.name.trim()}>
            {save.isPending && <Spinner />}
            {branch ? "Save" : "Add branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
