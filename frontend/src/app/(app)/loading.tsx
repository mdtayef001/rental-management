import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shown the instant a link is clicked, while the next screen is fetched.
 *
 * Without it a click appears to do nothing until the server answers. The shape is the one
 * every screen shares — a title, a toolbar, rows — so the page settles into place instead
 * of jumping.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
