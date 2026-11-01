"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * One list, two shapes.
 *
 * A table is the right thing on the counter laptop — columns of money and quantities line
 * up and can be compared down the page. On a phone it is the wrong thing entirely: six
 * columns become a horizontal scroll nobody discovers, so the same rows are stacked as
 * cards with the figures labelled.
 *
 * Both shapes are rendered and CSS picks one at `md`. That costs a little markup and buys
 * correctness: choosing in JavaScript would mean the server renders one shape, the browser
 * decides on another, and the page flashes on every load.
 *
 * A screen declares its columns once and gets both.
 */
export interface Column<T> {
  /** Stable id, and the accessible column name when `header` is an icon or blank. */
  id: string
  header?: React.ReactNode
  cell: (row: T) => React.ReactNode
  /**
   * What this column is on a phone card:
   *  - `title`   the headline (one per list)
   *  - `status`  sits beside the title, for a badge
   *  - `meta`    a labelled figure in the card body (the default)
   *  - `hidden`  table only — detail nobody needs on a 390px screen
   */
  role?: "title" | "status" | "meta" | "hidden"
  /** Numbers right-align, so the last digit of every figure is in the same place. */
  align?: "start" | "end"
  className?: string
  headClassName?: string
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  getKey: (row: T) => string
  /** Makes the whole row and the whole card open this. */
  href?: (row: T) => string
  /** Buttons that sit at the end of the row and the foot of the card. */
  actions?: (row: T) => React.ReactNode
  /** Describes the table for a screen reader, e.g. "Rentals". */
  label: string
  className?: string
}

export function DataView<T>({ rows, columns, getKey, href, actions, label, className }: Props<T>) {
  const router = useRouter()
  // The table shows everything; `hidden` only withholds a column from the phone card.
  const shown = columns
  const title = columns.find((c) => c.role === "title") ?? columns[0]
  const status = columns.find((c) => c.role === "status")
  const meta = columns.filter((c) => c !== title && c !== status && c.role !== "hidden")

  return (
    <>
      {/* Counter laptop. */}
      <div className={cn("hidden overflow-hidden rounded-lg border bg-card md:block", className)}>
        <Table>
          <TableHeader className="[&_tr]:border-b">
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {shown.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "h-9 px-3 text-xs font-medium tracking-wide text-muted-foreground",
                    column.align === "end" && "text-right",
                    column.headClassName,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
              {actions && <TableHead className="h-9 w-0 px-3" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const link = href?.(row)
              return (
                <TableRow
                  key={getKey(row)}
                  // The row is clickable, but the real link lives in the title cell below,
                  // so the keyboard, middle-click and "open in new tab" all still work.
                  onClick={link ? () => router.push(link) : undefined}
                  className={cn(link && "cursor-pointer")}
                >
                  {shown.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        column.align === "end" && "text-right tabular-nums",
                        column.className,
                      )}
                    >
                      {column === title && link ? (
                        <Link
                          href={link}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {column.cell(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell
                      className="px-3 py-2.5 text-right"
                      // Clicking a button in here must not also open the row.
                      onClick={(e) => e.stopPropagation()}
                    >
                      {actions(row)}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Phone. Same rows, stacked and labelled. */}
      <ul className={cn("space-y-2 md:hidden", className)} aria-label={label}>
        {rows.map((row) => {
          const link = href?.(row)
          return (
            <li key={getKey(row)} className="relative rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {link ? (
                    // Stretched link: the whole card is the tap target, and it is still one
                    // ordinary link to a screen reader and to "open in new tab".
                    <Link href={link} className="outline-none after:absolute after:inset-0 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      {title.cell(row)}
                    </Link>
                  ) : (
                    title.cell(row)
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {status?.cell(row)}
                  {link && <ChevronRight className="size-4 text-muted-foreground" />}
                </div>
              </div>

              {meta.length > 0 && (
                // Alignment is a table idea: it exists so a column of figures can be read
                // down the page. In a card there is no column, so everything reads from
                // the left and only the tabular figures carry over.
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm">
                  {meta.map((column) => (
                    <div key={column.id} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{column.header}</dt>
                      <dd className={cn("mt-0.5 truncate", column.align === "end" && "tabular-nums")}>
                        {column.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {actions && (
                // Above the stretched link, so these stay tappable.
                <div className="relative z-10 mt-3 flex flex-wrap gap-2 border-t pt-3">{actions(row)}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * The two lines most rows lead with: what it is, and its code or date underneath.
 * Keeping it here stops every screen inventing its own spacing for the same thing.
 */
export function Primary({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{children}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

/** A code, a SKU, a barcode: machine text, set in the mono face so it can be read back. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</span>
}
