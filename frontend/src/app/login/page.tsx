import type { Metadata } from "next"
import { LoginForm } from "./form"

export const metadata: Metadata = { title: "Log in" }

/**
 * The way in.
 *
 * One card, centred, nothing else on the page: whoever is here is either opening the shop
 * or locked out of it, and both want the same two fields. The mark is the only brand
 * moment in the product, so it carries the one signal colour.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-muted/40 p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary font-heading font-semibold text-primary-foreground">
            RM
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Rental Manager</h1>
            <p className="text-sm text-muted-foreground">Log in to rent out stock and take it back.</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>

        <p className="text-center text-xs text-pretty text-muted-foreground">
          Accounts are created by the owner. If you can&apos;t get in, ask them to reset your password.
        </p>
      </div>
    </main>
  )
}
