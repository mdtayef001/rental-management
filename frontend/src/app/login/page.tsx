import type { Metadata } from "next"
import { LoginForm } from "./form"

export const metadata: Metadata = { title: "Log in" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Rental Manager</h1>
          <p className="text-sm text-muted-foreground">Log in to rent out stock and take it back.</p>
        </div>
        <LoginForm next={typeof next === "string" ? next : undefined} />
        <p className="text-center text-xs text-muted-foreground">
          Accounts are created by the owner. If you can&apos;t get in, ask them to reset your password.
        </p>
      </div>
    </main>
  )
}
