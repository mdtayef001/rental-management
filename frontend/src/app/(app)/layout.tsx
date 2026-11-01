import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { MobileBar } from "@/components/mobile-bar"
import { SessionProvider } from "@/components/session"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { getContext } from "@/lib/auth/dal"
import { ROLE_HOME } from "@/lib/auth/roles"

/**
 * The shell every signed-in page sits in.
 *
 * The session is resolved once here — through the DAL, which asks Django rather than
 * trusting the token — and handed to client components through context. No page below has
 * to fetch the user again, so a screen costs one request for its own data.
 *
 * Whether the sidebar is open is read from its cookie on the server, so the shell renders
 * in the state the person left it in instead of snapping wide a moment after paint.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  // The super admin has no business, so none of these pages mean anything to them.
  if (ctx.user.role === "superadmin") redirect(ROLE_HOME.superadmin)

  const open = (await cookies()).get("sidebar_state")?.value !== "false"

  return (
    <SessionProvider user={ctx.user} business={ctx.business}>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar />
        <SidebarInset>
          {/* Sticky, so the way out of a long table is always one tap away. */}
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-sm sm:px-4">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-2">
              <CommandMenu />
            </div>
          </header>

          <main className="flex-1 px-3 py-5 sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
          </main>

          {/* The three things staff do all day, within thumb reach on a phone. */}
          <MobileBar />
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  )
}
