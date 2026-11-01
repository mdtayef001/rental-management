import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/errors"

let browserClient: QueryClient | undefined

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Anything this app changes refreshes what it touched straight away (see
        // use-mutations.ts), so this only covers changes made by other people: a page on
        // screen refetches after 30 seconds once the tab regains focus.
        staleTime: 30_000,
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
