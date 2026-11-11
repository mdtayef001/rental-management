"use client"

import { usePathname } from "next/navigation"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { CommandMenu } from "@/components/command-menu"

/**
 * Which screen you are on, and the way to any other one.
 *
 * The section name is repeated here rather than left to the page heading alone: with the
 * sidebar collapsed to an icon rail, or on a phone where it is a sheet, the heading can
 * scroll away and nothing on screen says where you are.
 */
const TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  scan: "Scan",
  "rent-out": "Rent out",
  "take-back": "Take back",
  rentals: "Rentals",
  returns: "Returns",
  customers: "Customers",
  bills: "Bills",
  products: "Products",
  purchases: "Purchases",
  suppliers: "Suppliers",
  "supplier-returns": "Sent back to supplier",
  reports: "Reports",
  users: "Team",
  activity: "Activity",
  settings: "Settings",
}

export function AppHeader() {
  const section = TITLES[usePathname().split("/")[1]] ?? ""

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-sm sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <span className="truncate text-sm font-medium">{section}</span>
      <div className="ml-auto flex items-center gap-2">
        <CommandMenu />
      </div>
    </header>
  )
}
