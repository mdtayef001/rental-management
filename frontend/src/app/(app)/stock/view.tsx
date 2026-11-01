"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Search, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useBranchScope } from "@/components/session"
import { useDebounced, usePaging, useProduct, useStock, useStockSummary } from "@/lib/data/queries"
import { count, plural } from "@/lib/format"

/** What is on the shelf, line by line, and the way to correct it. */
export function StockView({ canAdjust }: { canAdjust: boolean }) {
  const params = useSearchParams()
  const { branches, showPicker } = useBranchScope()
  const [text, setText] = useState("")
  const [branch, setBranch] = useState("")
  const [low, setLow] = useState(params.get("lowStock") === "1")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, branch, low)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)

  const filters = { search, branch, lowStock: low || undefined }
  const { data, isLoading, isFetching, isError, error, refetch } = useStock({ page, ...filters }, { pageSize })
  const { data: summary } = useStockSummary(filters)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description={
          summary
            ? `${count(summary.units)} units across ${plural(summary.lines, "line")}${summary.lowStock ? `, ${count(summary.lowStock)} running low` : ""}.`
            : "What is on the shelf right now."
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Product name or SKU"
            className="pl-9"
            aria-label="Search stock"
          />
        </div>
        {showPicker && (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Branch"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant={low ? "default" : "outline"} onClick={() => setLow((v) => !v)}>
          Low stock only
        </Button>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={4} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={low ? "Nothing is running low" : search ? `Nothing matches “${search}”` : "No stock recorded"}
          description={low ? "Every product is above its low-stock level." : "Add products and count them in."}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  {showPicker && <TableHead>Branch</TableHead>}
                  <TableHead className="text-right">On the shelf</TableHead>
                  {canAdjust && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((level) => (
                  <TableRow key={level.id}>
                    <TableCell>
                      <Link href={`/products/${level.productId}`} className="font-medium hover:underline">
                        {level.productName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{level.productSku}</div>
                    </TableCell>
                    {showPicker && <TableCell className="text-sm">{level.branchName}</TableCell>}
                    <TableCell className="text-right tabular-nums">
                      <span className={level.low ? "font-medium text-amber-600 dark:text-amber-500" : undefined}>
                        {count(level.quantity)}
                      </span>
                      {level.low && <div className="text-xs text-amber-600 dark:text-amber-500">Low</div>}
                    </TableCell>
                    {canAdjust && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAdjustingId(level.productId)}
                          aria-label={`Correct the stock of ${level.productName}`}
                        >
                          <SlidersHorizontal className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.count ?? 0}
            onPage={setPage}
            onPageSize={setPageSize}
            busy={isFetching}
          />
        </>
      )}

      {adjustingId && <AdjustFor productId={adjustingId} onClose={() => setAdjustingId(null)} />}
    </div>
  )
}

/** Loads the full product (it carries the per-branch stock map) before opening the dialog. */
function AdjustFor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { data: product } = useProduct(productId)
  if (!product) return null
  return <StockAdjustDialog open onOpenChange={(open) => !open && onClose()} product={product} />
}
