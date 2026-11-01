"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { Code, DataView, Primary, type Column } from "@/components/data-view"
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useBranchScope } from "@/components/session"
import { useDebounced, usePaging, useProduct, useStock, useStockSummary } from "@/lib/data/queries"
import { count, plural } from "@/lib/format"
import type { StockLevel } from "@/lib/types"

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

  const columns: Column<StockLevel>[] = [
    {
      id: "product",
      header: "Product",
      role: "title",
      cell: (level) => <Primary sub={<Code>{level.productSku}</Code>}>{level.productName}</Primary>,
    },
    {
      id: "low",
      header: "",
      role: "status",
      cell: (level) => (level.low ? <Badge variant="warning">Low</Badge> : null),
    },
    ...(showPicker
      ? [{ id: "branch", header: "Branch", cell: (level: StockLevel) => level.branchName } as Column<StockLevel>]
      : []),
    {
      id: "quantity",
      header: "On the shelf",
      align: "end",
      cell: (level) => (
        <span className={level.low ? "font-medium text-warning-soft-foreground dark:text-warning" : undefined}>
          {count(level.quantity)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock levels"
        description={
          summary
            ? `${count(summary.units)} units across ${plural(summary.lines, "line")}${summary.lowStock ? `, ${count(summary.lowStock)} running low` : ""}.`
            : "What is on the shelf right now."
        }
      />

      <Toolbar>
        <SearchInput value={text} onChange={setText} placeholder="Product name or SKU" label="Search stock" />
        {showPicker && (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="h-9 shrink-0 rounded-md border bg-card px-2 text-sm"
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
        <Button size="sm" variant={low ? "default" : "outline"} onClick={() => setLow((v) => !v)} className="h-9 shrink-0">
          Low stock only
        </Button>
      </Toolbar>

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
          <DataView
            label="Stock levels"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(level) => level.id}
            href={(level) => `/products/${level.productId}`}
            actions={
              canAdjust
                ? (level) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdjustingId(level.productId)}
                      aria-label={`Correct the stock of ${level.productName}`}
                    >
                      <SlidersHorizontal className="size-4" />
                      <span className="md:hidden">Correct the count</span>
                    </Button>
                  )
                : undefined
            }
          />
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
