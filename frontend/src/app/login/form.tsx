"use client"

import { useActionState, useRef, useState } from "react"
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type LoginState, login } from "@/lib/auth/actions"
import { DemoLogins } from "./demo-logins"

/**
 * The login form.
 *
 * A server action, so the password is posted to the Next.js server and the session cookies
 * are set there — the token never passes through client JavaScript, and the form still
 * works if JavaScript hasn't loaded yet.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {})
  const formRef = useRef<HTMLFormElement>(null)
  const [shown, setShown] = useState(false)

  return (
    <>
      <form ref={formRef} action={action} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            className="h-10"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            defaultValue={state.email}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              required
              className="h-10 pr-11"
            />
            {/* A button, not a checkbox, and never a submit: it only changes what is seen. */}
            <button
              type="button"
              onClick={() => setShown((on) => !on)}
              aria-label={shown ? "Hide password" : "Show password"}
              aria-pressed={shown}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {state.error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive-soft p-3 text-sm text-destructive-soft-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>

      <DemoLogins formRef={formRef} disabled={pending} />
    </>
  )
}
