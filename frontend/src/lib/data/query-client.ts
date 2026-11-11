import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/errors"

let browserClient: QueryClient | undefined

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // How long an answer is trusted before it is asked for again.
        //
        // Short, because two people work the same stock: what one till rents out or takes
        // back should be on the other till's screen within seconds, not minutes. Anything
        // this till changes refreshes at once regardless (see mutations.ts), and the
        // server refuses a stale action outright, so this is only about how soon a
        // colleague's change is seen. Things that rarely change (categories, branches,
        // reports) set a longer time of their own.
        staleTime: 15_000,
        // Kept in memory for a quarter of an hour after the last screen using it closed,
        // so going back to a list shows it at once and refreshes behind it if it is stale.
        gcTime: 15 * 60_000,
        // A refused or malformed request won't fix itself; a flaky connection might.
        retry: (failures, err) => failures < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
        refetchOnWindowFocus: true,
        // Coming back online after a dropped connection is the moment a screen is most
        // likely to be out of date.
        refetchOnReconnect: true,
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
