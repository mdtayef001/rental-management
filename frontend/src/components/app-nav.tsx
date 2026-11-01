"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity as ActivityIcon,
  Boxes,
  ChartColumn,
  FileSpreadsheet,
  LogOut,
  Moon,
  Package,
  ScanLine,
  Settings,
  ShoppingCart,
  Sun,
  Truck,
  Undo2,
  Users,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCanAccess, useSession } from "@/components/session"
import { roleLabel } from "@/lib/auth/roles"
import { useRentalSummary } from "@/lib/data/queries"
import { cn } from "@/lib/utils"

interface Item {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** "overdue" shows the count of overdue rentals as a badge. */
  badge?: "overdue"
}

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: ChartColumn },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/rentals", label: "Rentals", icon: Boxes, badge: "overdue" },
  { href: "/returns", label: "Returns", icon: Undo2 },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/stock", label: "Stock", icon: Boxes },
  { href: "/purchases", label: "Purchases", icon: ShoppingCart },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/users", label: "Team", icon: Users },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: Settings },
]

/**
 * The sidebar.
 *
 * Every item is filtered through the same `canAccess` the proxy and the server pages use,
 * so a user is never shown a link that would bounce them straight back.
 */
export function AppNav() {
  const path = usePathname()
  const { user } = useSession()
  // Only the people who can see rentals need the overdue badge polled.
  const canSeeRentals = useCanAccess("/rentals")
  const { data: summary } = useRentalSummary({ enabled: canSeeRentals, live: true })

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Main">
      {ITEMS.map((item) => (
        <NavLink key={item.href} item={item} path={path} overdue={summary?.overdue ?? 0} />
      ))}
      <div className="mt-auto space-y-1 pt-2">
        <ThemeToggle />
        <div className="rounded-md px-3 py-2">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{roleLabel(user)}</div>
        </div>
        {/* A plain anchor on purpose: a full page load lets /logout clear the cookies and
            drops the whole query cache with it. */}
        <Button variant="ghost" className="w-full justify-start gap-3" render={<a href="/logout" />}>
          <LogOut className="size-4" />
          Log out
        </Button>
      </div>
    </nav>
  )
}

function NavLink({ item, path, overdue }: { item: Item; path: string; overdue: number }) {
  // Called unconditionally for every item, so the hook order never changes.
  const allowed = useCanAccess(item.href)
  if (!allowed) return null

  const active = path === item.href || path.startsWith(item.href + "/")
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.badge === "overdue" && overdue > 0 && (
        <Badge variant="destructive" className="ml-auto">
          {overdue}
        </Badge>
      )}
    </Link>
  )
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // Both icons are always rendered and CSS shows one, rather than branching on the theme
  // in JavaScript. The server cannot know which theme the browser will resolve to, so any
  // branch here is a guaranteed hydration mismatch; this way the markup is identical on
  // both sides and the right icon appears the moment the stylesheet applies.
  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-3"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Switch between light and dark mode"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </Button>
  )
}

/** The account menu in the mobile header. */
export function UserMenu() {
  const { user, business } = useSession()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="max-w-[12rem] truncate">
            {user.name}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate font-medium">{user.email}</div>
          <div className="text-xs font-normal text-muted-foreground">
            {roleLabel(user)}
            {business && ` · ${business.name}`}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/logout" />}>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
