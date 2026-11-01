"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from "@/components/common"
import { useActivity, useActivityPeople, useDebounced, usePaging } from "@/lib/data/queries"
import { friendlyDateTime } from "@/lib/format"

/**
 * The audit log: who did what, and when.
 *
 * A flat timeline rather than a table, because the useful reading is chronological — "what
 * happened this afternoon" — not column-by-column comparison.
 */
export function ActivityView() {
  const people = useActivityPeople()
  const [text, setText] = useState("")
  const [person, setPerson] = useState("")
  const search = useDebounced(text.trim(), 300)
  const { page, pageSize, setPage, setPageSize } = usePaging(search, person)

  const { data, isLoading, isFetching, isError, error, refetch } = useActivity(
    { page, search, user: person },
    { pageSize },
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Activity" description="Everything anyone has done, newest first." />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search what happened"
            className="pl-9"
            aria-label="Search activity"
          />
        </div>
        {people.length > 0 && (
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Who"
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={8} columns={2} />
      ) : data && data.results.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Actions will show up here as people use the app." />
      ) : (
        <>
          <ul className="space-y-px rounded-lg border p-1">
            {data?.results.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2.5 hover:bg-accent/40">
                <span className="font-medium">{entry.action}</span>
                {entry.detail && <span className="min-w-0 flex-1 text-sm text-muted-foreground">{entry.detail}</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {entry.userName || "System"} · {friendlyDateTime(entry.at)}
                </span>
              </li>
            ))}
          </ul>

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
    </div>
  )
}
