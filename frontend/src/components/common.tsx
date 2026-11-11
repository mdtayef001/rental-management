"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, Check, ChevronDown, Copy, Inbox, Loader2, Search, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PAGE_SIZES,
  useActivity,
  useCustomers,
  useDebounced,
  usePlatformBusinesses,
  useProductSearch,
  useSuppliers,
} from "@/lib/data/queries"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The furniture every screen is built from.
 *
 * It is all in one file on purpose: these pieces set the rhythm of the app — the gap under
 * a heading, where the actions sit, how a filter row reads — and the only way twenty
 * screens stay consistent is if changing that rhythm means changing it once.
 */

/**
 * The top of a page: what you are looking at, and what you can do with it.
 *
 * The actions stay on the same line as the title on a laptop and wrap under it on a phone,
 * where a full-width button is easier to hit than one tucked in a corner.
 */
export function PageHeader({
  title,
  badge,
  description,
  back,
  children,
}: {
  title: string
  /** A status that belongs beside the name, e.g. "Low stock". */
  badge?: React.ReactNode
  description?: string
  /** A link back to the list this page came from. */
  back?: { href: string; label: string }
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {children && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{children}</div>
        )}
      </div>
    </div>
  )
}

/** The row above a list: a search box that grows, and filters that don't. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>{children}</div>
}

/** What a search box offers while someone is typing. */
type Suggest =
  /** Products by name, SKU or barcode. Picking one opens it. */
  | "products"
  /** Customers by name, company or phone. Picking one opens them. */
  | "customers"
  /** Customers again, but picking one puts their name in the box, to filter the list by them. */
  | "customer-names"
  /** Customers and products together, for lists that can be searched by either. */
  | "rentals"
  /** Suppliers by name, company or phone. */
  | "suppliers"
  /** Suppliers and products together. */
  | "purchases"
  /** Things that have happened, from the activity log. */
  | "activity"
  /** Businesses on the platform, by name or owner. */
  | "businesses"

interface Suggestion {
  id: string
  label: string
  sub?: string
  href?: string
}

/** The few best matches for what has been typed so far. Asks nothing until there is text. */
function useSuggestions(kind: Suggest | undefined, text: string): Suggestion[] {
  const typed = text.trim()
  const settled = useDebounced(typed, 200)
  const on = (...kinds: Suggest[]) => !!kind && kinds.includes(kind) && settled.length > 0
  const page = { page: 1, search: settled }
  const products = useProductSearch(typed, { enabled: !!kind && ["products", "rentals", "purchases"].includes(kind) })
  const customers = useCustomers(page, { pageSize: 6, enabled: on("customers", "customer-names", "rentals") })
  const suppliers = useSuppliers(page, { pageSize: 6, enabled: on("suppliers", "purchases") })
  const activity = useActivity(page, { pageSize: 10, enabled: on("activity") })
  const businesses = usePlatformBusinesses(page, { pageSize: 6, enabled: on("businesses") })
  if (!kind || !typed) return []

  const productRows = (open: boolean): Suggestion[] =>
    (products.data ?? []).map((p) => ({
      id: `p-${p.id}`,
      label: p.name,
      sub: open ? `${p.sku} · ${count(p.onHand)} on the shelf` : "Product",
      href: open ? `/products/${p.id}` : undefined,
    }))
  const customerRows = (open: boolean): Suggestion[] =>
    (customers.data?.results ?? []).map((c) => ({
      id: `c-${c.id}`,
      label: c.name,
      sub: [c.company, c.phone].filter(Boolean).join(" · ") || undefined,
      href: open ? `/customers/${c.id}` : undefined,
    }))
  const supplierRows = (): Suggestion[] =>
    (suppliers.data?.results ?? []).map((v) => ({
      id: `s-${v.id}`,
      label: v.name,
      sub: [v.company, v.phone].filter(Boolean).join(" · ") || "Supplier",
    }))

  let rows: Suggestion[]
  if (kind === "products") rows = productRows(true)
  else if (kind === "customers") rows = customerRows(true)
  else if (kind === "customer-names") rows = customerRows(false)
  else if (kind === "rentals") rows = [...customerRows(false).slice(0, 4), ...productRows(false).slice(0, 3)]
  else if (kind === "suppliers") rows = supplierRows()
  else if (kind === "purchases") rows = [...supplierRows().slice(0, 4), ...productRows(false).slice(0, 3)]
  else if (kind === "businesses")
    rows = (businesses.data?.results ?? []).map((b) => ({ id: b.id, label: b.name, sub: b.ownerEmail || undefined }))
  else rows = (activity.data?.results ?? []).map((entry) => ({ id: entry.id, label: entry.action, sub: entry.detail || undefined }))

  // One row per name: two customers called the same, or the same action ten times over,
  // would filter the list identically, so offering it twice is noise.
  const seen = new Set<string>()
  return rows
    .filter((row) => {
      if (row.href) return true
      const key = row.label.toLowerCase()
      return seen.has(key) ? false : (seen.add(key), true)
    })
    .slice(0, 7)
}

/**
 * A list's search box.
 *
 * With `suggest`, it offers the closest matches underneath as soon as a letter is typed,
 * so "se" is enough to find the sewing machine. Arrow keys move through them and Enter
 * picks one; typing on and ignoring them still filters the list below as before.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  label,
  suggest,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
  suggest?: Suggest
}) {
  const router = useRouter()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions = useSuggestions(suggest, value)
  // Once a suggestion's own name is in the box there is nothing left to suggest.
  const showing = open && suggestions.length > 0 && !suggestions.some((s) => !s.href && s.label === value)

  function pick(suggestion: Suggestion) {
    setOpen(false)
    setActive(-1)
    if (suggestion.href) router.push(suggestion.href)
    else onChange(suggestion.label)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!showing) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((i) => (i + 1) % suggestions.length)
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault()
            pick(suggestions[active])
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className="h-9 pl-9"
        aria-label={label}
        type="search"
        autoComplete="off"
        {...(suggest && {
          role: "combobox",
          "aria-expanded": showing,
          "aria-controls": listId,
          "aria-autocomplete": "list" as const,
          "aria-activedescendant": showing && active >= 0 ? `${listId}-${active}` : undefined,
        })}
      />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Suggestions for ${label.toLowerCase()}`}
          className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-lg border bg-popover py-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Mouse down, not click: the box loses focus on mouse down, which would close
              // the list before a click ever landed.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(suggestion)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="min-w-0 truncate font-medium">{suggestion.label}</span>
              {suggestion.sub && (
                <span className="max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">{suggestion.sub}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A text box that offers what has been typed there before.
 *
 * For fields like a product's category or unit, where the same handful of words is used
 * again and again: the list opens on focus, narrows as you type, and picking one fills the
 * box. It is still a text box — a word that is not on the list is simply a new one — so
 * nobody has to go and "create a category" before they can use it.
 */
export function ChoiceInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  noun = "option",
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** What one of these is called, for "New category". */
  noun?: string
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // Showing everything until something is typed, so opening the box is a way to browse.
  const [typed, setTyped] = useState(false)
  const text = value.trim().toLowerCase()
  const shown = typed && text ? options.filter((option) => option.toLowerCase().includes(text)) : options
  const isNew = !!text && !options.some((option) => option.toLowerCase() === text)
  const showing = open && (shown.length > 0 || isNew)

  function pick(option: string) {
    onChange(option)
    setOpen(false)
    setActive(-1)
    setTyped(false)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setTyped(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setTyped(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
            if (shown.length) setActive((i) => (i + 1) % shown.length)
          } else if (e.key === "ArrowUp" && showing && shown.length) {
            e.preventDefault()
            setActive((i) => (i <= 0 ? shown.length - 1 : i - 1))
          } else if (e.key === "Enter" && showing && active >= 0) {
            // Picks the highlighted one rather than submitting the form around it.
            e.preventDefault()
            pick(shown[active])
          } else if (e.key === "Escape" && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        className="pr-8"
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border bg-popover py-1 text-popover-foreground shadow-md"
        >
          {shown.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Mouse down, not click: the box loses focus on mouse down, which would close
              // the list before a click ever landed.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(option)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="truncate">{option}</span>
              {option.toLowerCase() === text && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
            </li>
          ))}
          {isNew && (
            <li className="border-t px-3 py-1.5 text-xs text-muted-foreground first:border-t-0" aria-hidden>
              New {noun}: <span className="font-medium text-foreground">{value.trim()}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * A code that copies itself when clicked: a SKU, a barcode.
 *
 * These get read out over the phone and pasted into other systems, and selecting a short
 * run of mono text by hand is fiddly. The whole value is the button.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label} ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          toast.success(`${label} copied`)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error("Couldn't copy. Select it and copy by hand.")
        }
      }}
      className="group -mx-1.5 inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left font-mono text-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-success" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      )}
    </button>
  )
}

/**
 * The filter row: one of these at a time, always visible.
 *
 * A segmented control rather than a dropdown, because the whole point is to see which
 * filter is on without opening anything — and on a phone it scrolls sideways instead of
 * wrapping into a second row that pushes the list down.
 */
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string; count?: number }[]
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="-mx-1 flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 px-1 [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn("ml-1.5 tabular-nums", active ? "text-muted-foreground" : "opacity-60")}>
                {count(option.count)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The band of figures at the top of a screen. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>
}

const TONES = {
  // Neutral on purpose. A tinted tile on every figure is a row of decoration; colour here
  // has to stay rare enough that catching sight of it means something. Ink Blue in
  // particular marks where a hand should go, not what kind of number this is.
  default: "bg-muted text-muted-foreground",
  good: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-destructive-soft text-destructive-soft-foreground",
}
export type Tone = keyof typeof TONES

/**
 * One number, with the icon that says what kind of number it is.
 *
 * The tone sits on the icon tile rather than on the figure. A whole row of coloured
 * numbers reads as decoration and stops meaning anything; a coloured tile next to a plain
 * figure still says "this is the one to look at", and the figure stays legible.
 *
 * That only works while most tiles are uncoloured, so `default` is deliberately neutral:
 * in a row of four, the one or two that are actually warning or danger are the ones that
 * catch the eye, and a quiet day is a quiet row.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  loading,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  tone?: Tone
  href?: string
  loading?: boolean
}) {
  const body = (
    <CardContent className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        )}
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-4.5" />
        </span>
      )}
    </CardContent>
  )
  return href ? (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="h-full transition-colors hover:bg-accent/40">{body}</Card>
    </Link>
  ) : (
    <Card className="h-full">{body}</Card>
  )
}

/** A small status word. Colour means the same thing everywhere: see the design notes. */
export function Pill({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "info" | "warning" | "good" | "danger"
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "info" && "bg-info-soft text-info-soft-foreground",
        tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
        tone === "good" && "bg-success-soft text-success-soft-foreground",
        tone === "danger" && "bg-destructive-soft text-destructive-soft-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * A select that matches the rest of the app.
 *
 * Raw `<select>` elements were scattered across the screens and each browser styles them
 * differently; this is the same control everywhere, keyboard included.
 */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  id,
  disabled,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  label?: string
}) {
  return (
    <Select items={options} value={value || null} onValueChange={(v) => onChange((v as string | null) ?? "")} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={cn("h-9 w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * "Are you sure", for the handful of actions that cannot be undone.
 *
 * The question is the title and the consequence is the description, because people read
 * the bold line and press the button — so the bold line has to be the thing they are
 * agreeing to, not the word "Warning".
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  open,
  onOpenChange,
}: {
  /** Leave out to control it yourself with `open`, e.g. from a menu item. */
  trigger?: React.ReactElement
  title: string
  description: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  /** Return false to keep the dialog open, e.g. when the server refused. */
  onConfirm: () => boolean | void | Promise<boolean | void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOpen = open ?? ownOpen
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                // A refusal from the server is an ordinary outcome here — "those are still
                // out on rent" — and the mutation has already said so in a toast. The
                // dialog stays open so the person can read it and cancel, rather than
                // freezing on a spinner because the rejection escaped.
                const result = await onConfirm()
                if (result !== false) setOpen(false)
              } catch {
                // Deliberately swallowed: see above.
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * What a list looks like while it loads.
 *
 * It mirrors the real thing in both shapes — rows on a laptop, cards on a phone — so the
 * page doesn't jump when the data lands.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <div className="h-9 border-b bg-muted/40" />
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-3 py-3 last:border-0">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn("h-4", c === 0 ? "flex-[2]" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {Array.from({ length: Math.min(rows, 4) }).map((_, r) => (
          <div key={r} className="space-y-3 rounded-lg border bg-card p-3">
            <Skeleton className="h-4 w-2/3" />
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card/40 px-6 py-12 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h2 className="mt-4 font-heading font-semibold">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

/** A failed query, with the server's own message and a way to try again. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong."
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive-soft/50 px-6 py-8 text-center">
      <AlertCircle className="mx-auto size-6 text-destructive" />
      <p className="mt-2 text-sm text-pretty">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />
}

/**
 * Page controls for a list.
 *
 * Shows which rows are on screen out of how many, because "page 3 of 12" tells a shop
 * owner far less than "51–75 of 287". On a phone the two buttons sit side by side at full
 * width and the rows-per-page picker drops away: nobody changes it on a phone.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  busy,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize?: (size: number) => void
  busy?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  if (total === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="tabular-nums">
          {count(from)}–{count(to)} of {count(total)}
        </span>
        {busy && <Spinner className="size-3.5" />}
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="hidden h-9 rounded-md border bg-card px-2 text-sm sm:block"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} className="max-sm:flex-1">
          Previous
        </Button>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} className="max-sm:flex-1">
          Next
        </Button>
      </div>
    </div>
  )
}

/** A label and its value, the shape most detail panels are made of. */
export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  )
}

/** A titled block of content. The app's one container; nothing nests inside another. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && <h2 className="font-heading font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}
