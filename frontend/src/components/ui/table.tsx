"use client"

import * as React from "react"
import { cn } from "cn"

/** How many rows a table shows before it scrolls inside its own frame. */
const VISIBLE_ROWS = 10

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const container = React.useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = React.useState<number>()

  // Ten rows tall, then it scrolls with its heading pinned, so a long list never pushes
  // the page controls off the screen. Measured rather than assumed, because rows are not
  // all one height: the frame ends exactly where the eleventh row would begin.
  React.useLayoutEffect(() => {
    const frame = container.current
    const table = frame?.querySelector("table")
    if (!frame || !table) return
    const measure = () => {
      const next = table.tBodies[0]?.rows[VISIBLE_ROWS]
      setMaxHeight(next ? next.offsetTop : undefined)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={container}
      data-slot="table-container"
      className="relative w-full overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
      // Reachable by keyboard only when there is something to scroll.
      tabIndex={maxHeight ? 0 : undefined}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Pinned while the body scrolls. Opaque, and with its rule drawn as a shadow, since a
      // collapsed border does not travel with a sticky row.
      className={cn("sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)] [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
