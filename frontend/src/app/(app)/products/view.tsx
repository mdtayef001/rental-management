"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { ProductDialog } from "@/components/product-form"
import { useCurrency, useSettings } from "@/components/session"
import { useCategories, useDebounced, usePaging, useProducts } from "@/lib/data/queries"
import { count, money } from "@/lib/format"

/** The catalogue, with what is on the shelf and what is out on rent for each line. */
export function ProductsView({ canEdit }: { canEdit: boolean }) {
  const currency = useCurrency()
  const settings = useSettings()
  const categories = useCategories()
  const [text, setText] = useState("")
  const [category, setCategory] = useState("")
  const [filter, setFilter] = useState<"" | "lowStock" | "rentable">("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, category, filter)
  const [adding, setAdding] = useState(false)

  const { data, isLoading, isFetching, isError, error, refetch } = useProducts(
    {
      page,
      search,
      category,
      lowStock: filter === "lowStock" || undefined,
      rentable: filter === "rentable" || undefined,
      sort: "name",
    },
    { pageSize },
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="What you rent out, and how much of it you hold.">
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            New product
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, SKU or barcode"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <div className="flex gap-1">
          {(
            [
              { value: "", label: "All" },
              { value: "rentable", label: "For rent" },
              { value: "lowStock", label: "Low stock" },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "No products yet"}
          description={search ? "Try a different name, SKU or barcode." : "Add what you rent out to get started."}
          action={canEdit ? <Button onClick={() => setAdding(true)}>Add a product</Button> : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Rates</TableHead>
                  <TableHead className="text-right">On shelf</TableHead>
                  <TableHead className="text-right">Out on rent</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.results.map((product) => {
                  const threshold = product.lowStockThreshold || settings.lowStockAlert
                  const low = product.onHand <= threshold
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Link href={`/products/${product.id}`} className="font-medium hover:underline">
                          {product.name}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{product.sku}</span>
                          {product.category && <span>{product.category}</span>}
                          {!product.rentable && <Badge variant="secondary">Not for rent</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.rentable ? (
                          <div className="flex flex-wrap gap-x-3 text-muted-foreground">
                            {product.rentDaily != null && <span>{money(product.rentDaily, currency)}/day</span>}
                            {product.rentWeekly != null && <span>{money(product.rentWeekly, currency)}/wk</span>}
                            {product.rentMonthly != null && <span>{money(product.rentMonthly, currency)}/mo</span>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={low ? "font-medium text-amber-600 dark:text-amber-500" : undefined}>
                          {count(product.onHand)}
                        </span>
                        {low && <div className="text-xs text-amber-600 dark:text-amber-500">Low</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product.outOnRent > 0 ? (
                          <Badge variant="secondary">{count(product.outOnRent)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {count(product.onHand + product.outOnRent)}
                      </TableCell>
                    </TableRow>
                  )
                })}
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

      <ProductDialog open={adding} onOpenChange={setAdding} onSaved={() => setAdding(false)} />
    </div>
  )
}
