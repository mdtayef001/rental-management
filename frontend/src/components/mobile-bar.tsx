"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Boxes, Menu, PackagePlus, ScanLine, Undo2 } from "lucide-react"
import { useSession } from "@/components/session"
import { useSidebar } from "@/components/ui/sidebar"
import { canAccess } from "@/lib/auth/roles"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/rent-out", label: "Rent out", icon: PackagePlus },
  { href: "/take-back", label: "Take back", icon: Undo2 },
  { href: "/rentals", label: "Rentals", icon: Boxes },
]

const TAB = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors"

/**
 * Bottom tab bar on phones.
 *
 * Staff spend the day renting out and taking back, one-handed, with stock in the other
 * hand — so those two sit under the thumb on every screen, with the scanner beside them.
 * Everything else is one tap further, behind "More", which opens the full menu.
 */
export function MobileBar() {
  const path = usePathname()
  const { user, business } = useSession()
  const { toggleSidebar } = useSidebar()

  const tabs = TABS.filter((tab) => canAccess(user, tab.href, business?.settings))

  return (
    <nav
      // Sticky to the bottom of the screen and padded for the phone's home indicator, so
      // the last row of a list is never hidden under it.
      className="sticky bottom-0 z-20 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      aria-label="Main"
    >
      {tabs.map((tab) => {
        const active = path === tab.href || path.startsWith(tab.href + "/")
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              TAB,
              active
                ? "text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {tab.label}
          </Link>
        )
      })}
      <button type="button" onClick={toggleSidebar} className={cn(TAB, "text-muted-foreground hover:text-foreground")}>
        <Menu className="size-5" />
        More
      </button>
    </nav>
  )
}
