import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/errors"

let browserClient: QueryClient | undefined

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // How long an answer is trusted before it is asked for again.
        //
        // Anything this app changes refreshes what it touched straight away (see
        // mutations.ts), whatever this is set to. So the only thing staleness costs is
        // seeing a colleague's change up to two minutes late — and for that, every screen
        // revisited inside the window is drawn from memory with no request to the server
        // or the database at all. The few figures that must stay current (the overdue
        // count) poll on their own.
        staleTime: 2 * 60_000,
        // Kept in memory for a quarter of an hour after the last screen using it closed,
        // so going back to a list shows it at once and refreshes behind it if it is stale.
        gcTime: 15 * 60_000,
        // A refused or malformed request won't fix itself; a flaky connection might.
        retry: (failures, err) => failures < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Never retry a write: a rental or a return must not happen twice because the
        // first response was slow.
        retry: false,
      },
    },
  })
}

/** One cache for the browser session; a fresh one per server render, so users never share data. */
export function getQueryClient() {
  if (typeof window === "undefined") return makeClient()
  return (browserClient ??= makeClient())
}
