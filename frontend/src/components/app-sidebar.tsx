"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity as ActivityIcon,
  Boxes,
  ChartColumn,
  ChevronsUpDown,
  FileSpreadsheet,
  History,
  PackagePlus,
  LogOut,
  Moon,
  Package,
  PackageX,
  Palette,
  ReceiptText,
  ScanLine,
  Settings,
  ShoppingCart,
  Truck,
  Undo2,
  Users,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { logoUrl } from "@/lib/logo"
import { useCanAccess, useSession } from "@/components/session"
import { ROLE_HOME, canAccess, roleLabel } from "@/lib/auth/roles"
import { useRentalSummary } from "@/lib/data/queries"

interface Item {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** "overdue" shows the count of overdue rentals. */
  badge?: "overdue"
}

/**
 * The navigation, in the order a rental shop thinks.
 *
 * Thirteen links in one flat list is a list nobody reads — the eye has nothing to anchor
 * to. Grouped, it becomes four short lists, each answering a different question: what am
 * I doing at the counter right now, who has what, what do we own, where did the money go.
 * "Today" sits first because it is where the day starts and where staff live — and it
 * carries the two things the counter actually does, renting out and taking back, so they
 * are one click from every screen rather than a button on some of them.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Today",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: ChartColumn },
      { href: "/rent-out", label: "Rent out", icon: PackagePlus },
      { href: "/take-back", label: "Take back", icon: Undo2 },
      { href: "/scan", label: "Scan", icon: ScanLine },
    ],
  },
  {
    label: "Hire",
    items: [
      { href: "/rentals", label: "Rentals", icon: Boxes, badge: "overdue" },
      { href: "/returns", label: "Returns", icon: History },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/bills", label: "Bills", icon: ReceiptText },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/purchases", label: "Purchases", icon: ShoppingCart },
      { href: "/suppliers", label: "Suppliers", icon: Truck },
      { href: "/supplier-returns", label: "Sent back", icon: PackageX },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/reports", label: "Reports", icon: FileSpreadsheet },
      { href: "/users", label: "Team", icon: Users },
      { href: "/activity", label: "Activity", icon: ActivityIcon },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
]

export function AppSidebar() {
  const path = usePathname()
  const { business, user } = useSession()
  // Staff without the dashboard land on their own first screen instead of being bounced.
  const home = canAccess(user, "/dashboard", business?.settings) ? "/dashboard" : ROLE_HOME[user.role]
  // Only the people who can see rentals need the overdue count polled.
  const canSeeRentals = useCanAccess("/rentals")
  const { data: summary } = useRentalSummary({ enabled: canSeeRentals, live: true })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        {/* The business's name is the way home, as a logo is on any site. */}
        <Link
          href={home}
          aria-label={`${business?.name ?? "Rental Manager"}, go to the dashboard`}
          className="flex items-center gap-2.5 rounded-md px-1 py-1.5 outline-none transition-colors group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
        >
          {logoUrl(business?.logoVersion) ? (
            // The business's own logo, on white so it reads the same in the dark theme.
            // eslint-disable-next-line @next/next/no-img-element -- already small, served by the API
            <img
              src={logoUrl(business?.logoVersion) ?? undefined}
              alt=""
              className="size-8 shrink-0 rounded-md bg-white object-contain p-0.5"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-semibold text-primary-foreground">
              {initials(business?.name)}
            </div>
          )}
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">{business?.name ?? "Rental Manager"}</div>
            <div className="truncate text-xs text-muted-foreground">Rental Manager</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <NavGroup key={group.label} group={group} path={path} overdue={summary?.overdue ?? 0} />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * One group of links.
 *
 * Every item is filtered through the same `canAccess` the proxy and the server pages use,
 * so nobody is shown a link that would bounce them straight back — and a group whose
 * items are all hidden disappears with them, rather than leaving a stray heading.
 */
function NavGroup({ group, path, overdue }: { group: (typeof GROUPS)[number]; path: string; overdue: number }) {
  const { user, business } = useSession()
  // `canAccess` rather than the hook, so visibility can be decided for a whole group at
  // once — a group with nothing in it should not leave its heading behind.
  const items = group.items.filter((item) => canAccess(user, item.href, business?.settings))
  if (items.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = path === item.href || path.startsWith(item.href + "/")
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={item.label}
                  // The signal colour means "you are here": the one place it tints a row.
                  className="h-9 data-active:bg-primary/12 data-active:text-primary dark:data-active:bg-primary/15"
                  render={<Link href={item.href} aria-current={active ? "page" : undefined} />}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                {item.badge === "overdue" && overdue > 0 && (
                  <SidebarMenuBadge className="group-data-[collapsible=icon]:hidden">
                    <Badge variant="destructive" className="px-1.5">
                      {overdue}
                    </Badge>
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function UserMenu() {
  const { user, business } = useSession()
  const { resolvedTheme, setTheme } = useTheme()
  const { state } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" tooltip={user.name} className="gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {initials(user.name)}
                </span>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{roleLabel(user)}</span>
                </span>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            side={state === "collapsed" ? "right" : "top"}
            align="start"
            className="w-(--anchor-width) min-w-56"
          >
            {/* Base UI's GroupLabel reads its group from context, so it has to sit inside a
                Group — on its own it throws and takes the whole menu down with it. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="space-y-0.5">
                <div className="truncate font-medium">{user.email}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {roleLabel(user)}
                  {business && ` · ${business.name}`}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {/* Both icons render and CSS picks one: the server cannot know which theme the
                  browser will resolve to, so branching here would mismatch on hydration. */}
              <Moon className="size-4 dark:hidden" />
              <Palette className="hidden size-4 dark:block" />
              <span className="dark:hidden">Dark mode</span>
              <span className="hidden dark:inline">Light mode</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* A plain anchor on purpose: a full page load lets /logout clear the cookies
                and drops the whole query cache with it. */}
            <DropdownMenuItem render={<a href="/logout" />}>
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function initials(name: string | undefined) {
  if (!name) return "RM"
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
}
