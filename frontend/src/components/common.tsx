"use client"

import Link from "next/link"
import { AlertCircle, ArrowLeft, Inbox, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PAGE_SIZES } from "@/lib/data/queries"
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
  description,
  back,
  children,
}: {
  title: string
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
          <h1 className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
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

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-9"
        aria-label={label}
        type="search"
      />
    </div>
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

/**
 * One number.
 *
 * Tone is for the number itself and is used sparingly: a figure turns amber or red only
 * when it is asking someone to do something about it.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
  href,
  loading,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "default" | "warning" | "danger" | "good"
  icon?: React.ComponentType<{ className?: string }>
  href?: string
  loading?: boolean
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground/70" />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div
          className={cn(
            "mt-1 font-heading text-2xl font-semibold tracking-tight tabular-nums",
            tone === "warning" && "text-warning-soft-foreground dark:text-warning",
            tone === "danger" && "text-destructive",
            tone === "good" && "text-success-soft-foreground dark:text-success",
          )}
        >
          {value}
        </div>
      )}
      {hint && <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>}
    </>
  )

  const shell = "rounded-lg border bg-card p-4"
  return href ? (
    <Link href={href} className={cn(shell, "transition-colors hover:border-primary/40 hover:bg-accent/40")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
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
