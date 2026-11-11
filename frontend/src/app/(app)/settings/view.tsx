"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ImageUp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader, Spinner } from "@/components/common"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { logoUrl, prepareLogo } from "@/lib/logo"
import type { Business, BusinessSettings, PermissionId } from "@/lib/types"

const MANAGER_PERMISSIONS: { id: PermissionId; label: string; hint: string }[] = [
  { id: "managerUsers", label: "Manage the team", hint: "Add and edit staff accounts." },
  { id: "managerProducts", label: "Change products", hint: "Add products and edit rates." },
  { id: "managerCustomers", label: "Edit customers", hint: "Change or remove customer records." },
  { id: "managerActivity", label: "See the activity log", hint: "Read what everyone has done." },
  { id: "managerProfit", label: "See profit and reports", hint: "What things cost and what they earn." },
]

const STAFF_PERMISSIONS: { id: PermissionId; label: string; hint: string }[] = [
  { id: "staffWalkInRentals", label: "Rent to walk-ins", hint: "Off: staff must pick or add a customer every time." },
  { id: "staffCreateProducts", label: "Add products", hint: "Off: only the owner and managers add products." },
]

/**
 * Business settings.
 *
 * Grouped by the question each answers — how we charge, who may do what, what the receipt
 * says — rather than by where the value happens to live in the data.
 */
export function SettingsView({ business }: { business: Business }) {
  const router = useRouter()
  const [settings, setSettings] = useState<BusinessSettings>(business.settings)
  const [details, setDetails] = useState({
    name: business.name,
    phone: business.phone,
    address: business.address,
    industry: business.industry,
  })
  const [saving, setSaving] = useState(false)

  function patch<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      await request("business/", { method: "PATCH", body: { ...details, settings } })
      toast.success("Settings saved")
      // The session comes from the server layout, so refresh it to pick the changes up.
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save the settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="How this business charges, and who may do what.">
        <Button onClick={save} disabled={saving}>
          {saving && <Spinner />}
          Save changes
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The business</CardTitle>
          <CardDescription>This is what appears at the top of every receipt, bill and report.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={details.name} onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-phone">Phone</Label>
            <Input
              id="s-phone"
              value={details.phone}
              onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="s-address">Address</Label>
            <Input
              id="s-address"
              value={details.address}
              onChange={(e) => setDetails((d) => ({ ...d, address: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-currency">Currency</Label>
            <Input
              id="s-currency"
              value={settings.currency}
              onChange={(e) => patch("currency", e.target.value.toUpperCase())}
              maxLength={3}
              className="w-28 font-mono"
            />
          </div>
        </CardContent>
      </Card>

      <LogoCard version={business.logoVersion} name={business.name} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Renting</CardTitle>
          <CardDescription>The defaults staff start from, and how lateness is charged.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-plan">Default plan</Label>
              <select
                id="s-plan"
                value={settings.rentals.defaultPlan}
                onChange={(e) =>
                  patch("rentals", { ...settings.rentals, defaultPlan: e.target.value as BusinessSettings["rentals"]["defaultPlan"] })
                }
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
              >
                <option value="daily">Per day</option>
                <option value="weekly">Per week</option>
                <option value="monthly">Per month</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-low">Warn when stock drops to</Label>
              <Input
                id="s-low"
                type="number"
                min={0}
                value={settings.lowStockAlert}
                onChange={(e) => patch("lowStockAlert", Math.max(0, Number(e.target.value)))}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="s-late">Late fee</Label>
            <div className="flex items-center gap-2">
              <Input
                id="s-late"
                type="number"
                min={0}
                step="0.1"
                value={settings.rentals.lateFeeMultiplier}
                onChange={(e) =>
                  patch("rentals", { ...settings.rentals, lateFeeMultiplier: Math.max(0, Number(e.target.value)) })
                }
                className="w-28 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">× the daily rate, per day late</span>
            </div>
            {/* This is a money decision with a non-obvious consequence, so it says plainly
                what the number the owner just typed will actually charge. */}
            <p className="text-sm text-muted-foreground">
              {settings.rentals.lateFeeMultiplier === 0 ? (
                <>No penalty. Late days are charged at the normal rate, like any other day out.</>
              ) : (
                <>
                  A late day costs the normal rent <strong>plus</strong> {settings.rentals.lateFeeMultiplier}× the daily
                  rate on top
                  {settings.rentals.lateFeeMultiplier === 1 && " — so double a normal day"}. Set it to 0 to charge the
                  plain rate.
                </>
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Toggle
              checked={settings.rentals.allowOpenEnded}
              onChange={(v) => patch("rentals", { ...settings.rentals, allowOpenEnded: v })}
              label="Allow rentals with no return date"
              hint="Off: every rental must have a date it is due back."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What managers may do</CardTitle>
          <CardDescription>You can always do all of these. These switches apply to managers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {MANAGER_PERMISSIONS.map((permission) => (
            <Toggle
              key={permission.id}
              checked={settings.permissions[permission.id]}
              onChange={(v) => patch("permissions", { ...settings.permissions, [permission.id]: v })}
              label={permission.label}
              hint={permission.hint}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What staff may do</CardTitle>
          <CardDescription>
            These apply to everyone on staff. Individual rights are set per person on the Team screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {STAFF_PERMISSIONS.map((permission) => (
            <Toggle
              key={permission.id}
              checked={settings.permissions[permission.id]}
              onChange={(v) => patch("permissions", { ...settings.permissions, [permission.id]: v })}
              label={permission.label}
              hint={permission.hint}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts and bills</CardTitle>
          <CardDescription>Your own line at the bottom of every receipt and bill.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={settings.receiptNote}
            onChange={(e) => patch("receiptNote", e.target.value)}
            rows={3}
            placeholder="Items must be returned in working order. Late returns are charged per day."
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving && <Spinner />}
          Save changes
        </Button>
      </div>
    </div>
  )
}

/**
 * The business's own logo.
 *
 * Saved the moment it is chosen rather than with the Save button: it is a file, not a
 * setting, and "I picked it but it isn't on my bill" is the confusion that would follow.
 * The picture is scaled down in the browser first, so a photo straight off a phone works.
 */
function LogoCard({ version, name }: { version: string; name: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const src = logoUrl(version)

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await work()
      toast.success(done)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't save the logo.")
    } finally {
      setBusy(false)
    }
  }

  function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file again still fires a change.
    e.target.value = ""
    if (!file) return
    void run(
      async () => request("business/logo/", { method: "PUT", body: { image: await prepareLogo(file) } }),
      "Logo saved. It is on your receipts, bills and reports now.",
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Logo</CardTitle>
        <CardDescription>
          Printed at the top of every receipt, bill and report, on paper and in the PDF. A PNG with a clear
          background looks best.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Shown on white, because paper is where it will be seen. */}
        <div className="flex h-24 w-full shrink-0 items-center justify-center rounded-lg border bg-white p-3 sm:w-56">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- already small, served by the API
            <img src={src} alt={`${name} logo`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-neutral-500">No logo yet</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={choose} tabIndex={-1} />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Spinner /> : <ImageUp className="size-4" />}
            {src ? "Change logo" : "Upload logo"}
          </Button>
          {src && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => request("business/logo/", { method: "DELETE" }), "Logo removed")}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex items-start gap-3 rounded-md p-2 hover:bg-accent/40">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
