"use client"

import { useState } from "react"
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, TableSkeleton, Toolbar } from "@/components/common"
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
    <div className="space-y-5">
      <PageHeader title="Activity" description="Everything anyone has done, newest first." />

      <Toolbar>
        <SearchInput value={text} onChange={setText} placeholder="Search what happened" label="Search activity" suggest="activity" />
        {people.length > 0 && (
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="h-9 shrink-0 rounded-md border bg-card px-2 text-sm"
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
      </Toolbar>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={8} columns={2} />
      ) : data && data.results.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Actions will show up here as people use the app." />
      ) : (
        <>
          {/* A timeline, not a table: the useful reading here is chronological, and on a
              phone the who-and-when drops to its own line rather than being squeezed. */}
          {/* About ten entries tall, then it scrolls, like every table in the app. */}
          <ul className="max-h-[30rem] divide-y overflow-y-auto rounded-lg border bg-card">
            {data?.results.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-accent/40 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="shrink-0 font-medium">{entry.action}</span>
                {entry.detail && <span className="min-w-0 flex-1 text-sm text-muted-foreground">{entry.detail}</span>}
                <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto">
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
