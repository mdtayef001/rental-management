"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  Toolbar,
} from "@/components/common"
import { Code, DataView, Primary, type Column } from "@/components/data-view"
import { ProductDialog } from "@/components/product-form"
import { useCurrency, useSettings } from "@/components/session"
import { useCategories, useDebounced, usePaging, useProducts } from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import type { Product } from "@/lib/types"

const FILTERS = [
  { value: "", label: "All" },
  { value: "rentable", label: "For rent" },
  { value: "lowStock", label: "Low stock" },
] as const

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

  function isLow(product: Product) {
    return product.onHand <= (product.lowStockThreshold || settings.lowStockAlert)
  }

  const columns: Column<Product>[] = [
    {
      id: "product",
      header: "Product",
      role: "title",
      cell: (product) => (
        <Primary
          sub={
            <>
              <Code>{product.sku}</Code>
              {product.category && <span> · {product.category}</span>}
            </>
          }
        >
          {product.name}
        </Primary>
      ),
    },
    {
      id: "flags",
      header: "",
      role: "status",
      cell: (product) =>
        !product.rentable ? (
          <Badge variant="outline">Not for rent</Badge>
        ) : isLow(product) ? (
          <Badge variant="warning">Low stock</Badge>
        ) : null,
    },
    {
      id: "rates",
      header: "Rates",
      cell: (product) =>
        product.rentable ? (
          <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {product.rentDaily != null && <span>{money(product.rentDaily, currency)}/day</span>}
            {product.rentWeekly != null && <span>{money(product.rentWeekly, currency)}/wk</span>}
            {product.rentMonthly != null && <span>{money(product.rentMonthly, currency)}/mo</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "shelf",
      header: "On shelf",
      align: "end",
      cell: (product) => (
        <span className={isLow(product) ? "font-medium text-warning-soft-foreground dark:text-warning" : undefined}>
          {count(product.onHand)}
        </span>
      ),
    },
    {
      id: "out",
      header: "Out on rent",
      align: "end",
      cell: (product) =>
        product.outOnRent > 0 ? (
          <Badge variant="info">{count(product.outOnRent)}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "total",
      header: "Total",
      align: "end",
      cell: (product) => <span className="text-muted-foreground">{count(product.onHand + product.outOnRent)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Products" description="What you rent out, and how much of it you hold.">
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            New product
          </Button>
        )}
      </PageHeader>

      <Toolbar>
        <SearchInput value={text} onChange={setText} placeholder="Name, SKU or barcode" label="Search products" />
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 shrink-0 rounded-md border bg-card px-2 text-sm"
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
        <FilterTabs value={filter} onChange={setFilter} options={FILTERS} label="Filter products" />
      </Toolbar>

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
          <DataView
            label="Products"
            rows={data?.results ?? []}
            columns={columns}
            getKey={(product) => product.id}
            href={(product) => `/products/${product.id}`}
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

      <ProductDialog open={adding} onOpenChange={setAdding} onSaved={() => setAdding(false)} />
    </div>
  )
}
