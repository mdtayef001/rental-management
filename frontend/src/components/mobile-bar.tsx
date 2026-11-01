"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Boxes, ScanLine, Undo2 } from "lucide-react"
import { useCanAccess } from "@/components/session"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/rentals", label: "Rentals", icon: Boxes },
  { href: "/returns", label: "Returns", icon: Undo2 },
]

/**
 * Bottom tab bar on phones.
 *
 * Staff spend the day on two screens — scan out, scan in — and on a phone those need to be
 * one thumb-tap away, not behind a menu.
 */
export function MobileBar() {
  const path = usePathname()
  const can = {
    "/scan": useCanAccess("/scan"),
    "/rentals": useCanAccess("/rentals"),
    "/returns": useCanAccess("/returns"),
  } as Record<string, boolean>

  const tabs = TABS.filter((tab) => can[tab.href])
  if (tabs.length === 0) return null

  return (
    <nav
      className="sticky bottom-0 flex border-t bg-background/95 backdrop-blur lg:hidden"
      aria-label="Quick actions"
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
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
