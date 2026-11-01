"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Activity as ActivityIcon,
  Boxes,
  ChartColumn,
  FileSpreadsheet,
  Package,
  PackageX,
  ScanLine,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  Undo2,
  User,
  Users,
  Warehouse,
} from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { useSession } from "@/components/session"
import { canAccess } from "@/lib/auth/roles"
import { useCustomers, useDebounced, useProductSearch } from "@/lib/data/queries"

const PAGES = [
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/rent-out", label: "Rent out", icon: Package },
  { href: "/take-back", label: "Take back", icon: Undo2 },
  { href: "/dashboard", label: "Dashboard", icon: ChartColumn },
  { href: "/rentals", label: "Rentals", icon: Boxes },
  { href: "/returns", label: "Returns", icon: Undo2 },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/stock", label: "Stock levels", icon: Warehouse },
  { href: "/purchases", label: "Purchases", icon: ShoppingCart },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/supplier-returns", label: "Sent back", icon: PackageX },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/users", label: "Team", icon: Users },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: Settings },
]

/**
 * Ctrl-K: go anywhere, or find a customer or a machine, without reaching for the mouse.
 *
 * A counter screen is used under time pressure with somebody waiting, and the fastest
 * route to "where is Mr. X's rental" is typing his name. Pages are listed from the same
 * rules as the sidebar, so this never offers a screen the person cannot open.
 *
 * Both searches only run once there are two characters and only while the dialog is open,
 * so the shortcut costs nothing until it is used.
 */
export function CommandMenu() {
  const router = useRouter()
  const { user, business } = useSession()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState("")
  const search = useDebounced(query.trim(), 250)
  const searching = open && search.length > 1

  const products = useProductSearch(search, { enabled: searching && canAccess(user, "/products", business?.settings) })
  const customers = useCustomers(
    { page: 1, search },
    { pageSize: 5, enabled: searching && canAccess(user, "/customers", business?.settings) },
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  function go(href: string) {
    setOpen(false)
    setQuery("")
    router.push(href)
  }

  const people = customers.data?.results ?? []
  const machines = products.data ?? []
  // Filtered on the raw query, not the debounced one: the page list is in memory, and
  // waiting 250ms to drop it means a fast typist can press Enter on a screen that has
  // nothing to do with what they typed while the server search is still in flight.
  const typed = query.trim().toLowerCase()
  const pages = PAGES.filter(
    (page) => canAccess(user, page.href, business?.settings) && (!typed || page.label.toLowerCase().includes(typed)),
  )

  // Which row Enter will take. The results arrive from the server after the typing has
  // stopped, so the highlight has to follow them: whatever was highlighted is kept while
  // it is still in the list, and otherwise the first row takes over. Deriving it here
  // rather than in an effect means it is never briefly pointing at a row that is gone.
  const values = [
    ...people.slice(0, 5).map((customer) => `c-${customer.id}`),
    ...machines.slice(0, 5).map((product) => `p-${product.id}`),
    ...pages.map((page) => page.href),
  ]
  const highlighted = values.includes(selected) ? selected : (values[0] ?? "")

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9 justify-start gap-2 px-2.5 text-muted-foreground sm:w-60"
      >
        <Search className="size-4" />
        <span className="hidden truncate sm:inline">Search or jump to…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a screen, a customer or a machine">
        {/* People and products are searched by Django, so cmdk's own filter would only
            throw those results away again; the page list is filtered above instead. */}
        <Command shouldFilter={false} value={highlighted} onValueChange={setSelected}>
          {/* Explicitly focused: several screens autofocus their own scan field, and
              without this the first keystrokes after Ctrl-K land there instead. */}
          <CommandInput
            autoFocus
            placeholder="Type a name, a code, or a screen…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {pages.length === 0 && people.length === 0 && machines.length === 0 && (
              <CommandEmpty>{searching ? "Searching…" : `Nothing matches “${query.trim()}”.`}</CommandEmpty>
            )}

            {people.length > 0 && (
              <CommandGroup heading="Customers">
                {people.slice(0, 5).map((customer) => (
                  <CommandItem key={customer.id} value={`c-${customer.id}`} onSelect={() => go(`/customers/${customer.id}`)}>
                    <User className="size-4" />
                    <span className="truncate">{customer.name}</span>
                    <CommandShortcut className="font-mono">{customer.phone}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {machines.length > 0 && (
              <CommandGroup heading="Products">
                {machines.slice(0, 5).map((product) => (
                  <CommandItem key={product.id} value={`p-${product.id}`} onSelect={() => go(`/products/${product.id}`)}>
                    <Package className="size-4" />
                    <span className="truncate">{product.name}</span>
                    <CommandShortcut className="font-mono">{product.sku}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(people.length > 0 || machines.length > 0) && pages.length > 0 && <CommandSeparator />}

            {pages.length > 0 && (
              <CommandGroup heading="Go to">
                {pages.map((page) => {
                  const Icon = page.icon
                  return (
                    <CommandItem key={page.href} value={page.href} onSelect={() => go(page.href)}>
                      <Icon className="size-4" />
                      {page.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
