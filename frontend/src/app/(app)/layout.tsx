import { redirect } from "next/navigation"
import { AppNav, UserMenu } from "@/components/app-nav"
import { MobileBar } from "@/components/mobile-bar"
import { SessionProvider } from "@/components/session"
import { getContext } from "@/lib/auth/dal"
import { ROLE_HOME } from "@/lib/auth/roles"

/**
 * The shell every signed-in page sits in.
 *
 * The session is resolved once here — through the DAL, which asks Django rather than
 * trusting the token — and handed to client components through context. No page below has
 * to fetch the user again, so a screen costs one request for its own data.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  // The super admin has no business, so none of these pages mean anything to them.
  if (ctx.user.role === "superadmin") redirect(ROLE_HOME.superadmin)

  return (
    <SessionProvider user={ctx.user} business={ctx.business}>
      <div className="flex min-h-full flex-1">
        {/* Sidebar on a laptop at the counter. */}
        <aside className="hidden w-60 shrink-0 border-r lg:flex lg:flex-col">
          <div className="border-b px-4 py-4">
            <div className="truncate font-semibold">{ctx.business?.name ?? "Rental Manager"}</div>
            <div className="text-xs text-muted-foreground">Rental Manager</div>
          </div>
          <AppNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header on a phone, where the sidebar is hidden. */}
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3 lg:hidden">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{ctx.business?.name ?? "Rental Manager"}</div>
            </div>
            <UserMenu />
          </header>

          <main className="flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
          </main>

          {/* The three things staff do all day, within thumb reach on a phone. */}
          <MobileBar />
        </div>
      </div>
    </SessionProvider>
  )
}
