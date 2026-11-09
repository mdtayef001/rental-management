"use client"

import type { RefObject } from "react"
import { Button } from "@/components/ui/button"

/**
 * The seeded demo accounts, as one-click logins.
 *
 * `seed_demo` creates these four with a shared password, and typing them out on every
 * reload is friction nobody needs while developing. Each button fills the real fields and
 * submits the real form, so the login path being exercised is the same one a user takes.
 *
 * Shown automatically outside production, and on a deployed demo when
 * NEXT_PUBLIC_SHOW_DEMO_LOGINS is set — a demo in front of a client should not stall on
 * someone mistyping a password. A real production deployment leaves the flag unset and
 * these buttons never render.
 */
const ACCOUNTS = [
  { role: "Super admin", email: "admin@example.com" },
  { role: "Owner", email: "owner@example.com" },
  { role: "Manager", email: "manager@example.com" },
  { role: "Staff", email: "staff@example.com" },
] as const

const PASSWORD = "rental-demo-2026"

export function DemoLogins({ formRef, disabled }: { formRef: RefObject<HTMLFormElement | null>; disabled?: boolean }) {
  const show =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "true"
  if (!show) return null

  function fillAndSubmit(email: string) {
    const form = formRef.current
    if (!form) return
    const emailField = form.elements.namedItem("email") as HTMLInputElement | null
    const passwordField = form.elements.namedItem("password") as HTMLInputElement | null
    if (!emailField || !passwordField) return
    emailField.value = email
    passwordField.value = PASSWORD
    form.requestSubmit()
  }

  return (
    <div className="mt-5 space-y-3 border-t pt-5">
      <p className="text-xs font-medium text-muted-foreground">Demo accounts — development only</p>
      <div className="grid grid-cols-2 gap-2">
        {ACCOUNTS.map((account) => (
          <Button
            key={account.email}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => fillAndSubmit(account.email)}
            title={`${account.email} · ${PASSWORD}`}
          >
            {account.role}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        All four use the password <code className="font-mono">{PASSWORD}</code>.
      </p>
    </div>
  )
}
