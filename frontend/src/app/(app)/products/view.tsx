"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ConfirmAction,
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
import { StockAdjustDialog } from "@/components/stock-adjust"
import { useDeleteProduct } from "@/lib/data/mutations"
import { useCurrency } from "@/components/session"
import { useCategories, useDebounced, usePaging, useProducts } from "@/lib/data/queries"
import { count, money } from "@/lib/format"
import type { Product } from "@/lib/types"
import { msg, t } from "@/lib/i18n"

const FILTERS = [
  { value: "", label: msg("All") },
  { value: "lowStock", label: msg("Low stock") },
] as const

/** The catalogue, with what is on the shelf and what is out on rent for each line. */
export function ProductsView({
  canEdit,
  canAdjust,
  canDelete,
}: {
  canEdit: boolean
  canAdjust: boolean
  canDelete: boolean
}) {
  const currency = useCurrency()
  const categories = useCategories()
  const params = useSearchParams()
  const [text, setText] = useState("")
  const [category, setCategory] = useState("")
  // The dashboard links straight here for "products running low".
  const [filter, setFilter] = useState<"" | "lowStock" | "rentable">(
    params.get("filter") === "lowStock" ? "lowStock" : "",
  )
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const remove = useDeleteProduct()
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


  const columns: Column<Product>[] = [
    {
      id: "product",
      header: t("Product"),
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
          <Badge variant="outline">{t("Not for rent")}</Badge>
        ) : product.isLow ? (
          <Badge variant="warning">{t("Low stock")}</Badge>
        ) : null,
    },
    {
      id: "rates",
      header: t("Rates"),
      cell: (product) =>
        product.rentable ? (
          <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {product.rentDaily != null && <span>{money(product.rentDaily, currency)}/{t("day")}</span>}
            {product.rentWeekly != null && <span>{money(product.rentWeekly, currency)}/wk</span>}
            {product.rentMonthly != null && <span>{money(product.rentMonthly, currency)}/mo</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "shelf",
      header: t("On shelf"),
      align: "end",
      cell: (product) => (
        <span className={product.isLow ? "font-medium text-warning-soft-foreground dark:text-warning" : undefined}>
          {count(product.onHand)}
        </span>
      ),
    },
    {
      id: "out",
      header: t("Out on rent"),
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
      header: t("Total"),
      align: "end",
      cell: (product) => <span className="text-muted-foreground">{count(product.onHand + product.outOnRent)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title={t("Products")} description={t("What you rent out, and how much of it you hold.")}>
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("New product")}
          </Button>
        )}
      </PageHeader>

      <Toolbar>
        <SearchInput value={text} onChange={setText} placeholder={t("Name, SKU or barcode")} label={t("Search products")} suggest="products" />
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 shrink-0 rounded-md border bg-card px-2 text-sm"
            aria-label={t("Category")}
          >
            <option value="">{t("All categories")}</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <FilterTabs value={filter} onChange={setFilter} options={FILTERS} label={t("Filter products")} />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={search ? t("Nothing matches “{search}”", { search }) : t("No products yet")}
          description={search ? t("Try a different name, SKU or barcode.") : t("Add what you rent out to get started.")}
          action={canEdit ? <Button onClick={() => setAdding(true)}>{t("Add a product")}</Button> : undefined}
        />
      ) : (
        <>
          <DataView
            label={t("Products")}
            rows={data?.results ?? []}
            columns={columns}
            getKey={(product) => product.id}
            href={(product) => `/products/${product.id}`}
            actions={
              canAdjust || canDelete
                ? (product) => (
                    <>
                      {canAdjust && (
                        <Button variant="outline" size="sm" onClick={() => setAdjusting(product)}>
                          <SlidersHorizontal className="size-4" />
                          <span className="md:sr-only">{t("Correct the count")}</span>
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(product)}>
                          <Trash2 className="size-4" />
                          <span className="md:sr-only">{t("Delete")}</span>
                        </Button>
                      )}
                    </>
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

      <ProductDialog open={adding} onOpenChange={setAdding} onSaved={() => setAdding(false)} />

      {adjusting && (
        <StockAdjustDialog open onOpenChange={(open) => !open && setAdjusting(null)} product={adjusting} />
      )}

      {/* Deleting is explained in terms of what survives it, because the thing people are
          really asking is "will this wreck my old receipts". It doesn't. */}
      {deleting && (
        <ConfirmAction
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t("Delete {name}?", { name: deleting.name })}
          description={t(
            "It comes out of the catalogue and off the scanner straight away. Past rentals, receipts and bills keep its name and SKU exactly as they were printed, so nothing in your records changes. A product that has never been rented, bought or counted is removed completely.",
          )}
          confirmLabel={t("Delete it")}
          destructive
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
