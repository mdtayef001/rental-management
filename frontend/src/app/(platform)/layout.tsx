import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SessionProvider } from "@/components/session"
import { ThemeToggle } from "@/components/app-nav"
import { getContext } from "@/lib/auth/dal"
import { ROLE_HOME } from "@/lib/auth/roles"

/**
 * The super admin's shell.
 *
 * Deliberately separate from the business app: the super admin creates and suspends
 * businesses but has no endpoint that reads one's rentals, customers or money, so giving
 * them the business navigation would only offer doors that are locked.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/">) {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (ctx.user.role !== "superadmin") redirect(ROLE_HOME[ctx.user.role])

  return (
    <SessionProvider user={ctx.user} business={null}>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
          <div>
            <div className="font-semibold">Rental Manager</div>
            <div className="text-xs text-muted-foreground">Platform administration</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-sm text-muted-foreground sm:block">{ctx.user.email}</div>
            <div className="w-36">
              <ThemeToggle />
            </div>
            <Button variant="outline" size="sm" render={<a href="/logout" />}>
              Log out
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-5xl space-y-6">{children}</div>
        </main>
      </div>
    </SessionProvider>
  )
}
