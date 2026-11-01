"use client"

import { AlertCircle, Inbox, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PAGE_SIZES } from "@/lib/data/queries"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A page heading with optional actions on the right. */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** One number on a dashboard. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  loading,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "default" | "warning" | "danger" | "good"
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "warning" && "text-amber-600 dark:text-amber-500",
            tone === "danger" && "text-destructive",
            tone === "good" && "text-emerald-600 dark:text-emerald-500",
          )}
        >
          {value}
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Shown while a list loads for the first time, matching the row height so nothing jumps. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-10", c === 0 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
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
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** A failed query, with the server's own message and a way to try again. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong."
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
      <AlertCircle className="mx-auto size-7 text-destructive" />
      <p className="mt-2 text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
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
 * owner far less than "51–75 of 287".
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
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>
          {count(from)}–{count(to)} of {count(total)}
        </span>
        {busy && <Spinner />}
      </div>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="text-muted-foreground">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
