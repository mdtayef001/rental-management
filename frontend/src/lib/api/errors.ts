// Turns a Django REST Framework error body into one readable sentence.
// Shared by the server and browser API clients.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * DRF reports errors in several shapes: `{"detail": "..."}`, `{"field": ["..."]}`, or a
 * list of those for a list field. This digs out the first human sentence, whichever shape
 * arrived, so every screen can show something better than "Request failed".
 */
export function errorMessage(data: unknown, status: number): string {
  const first = (value: unknown): string | null => {
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.map(first).find(Boolean) ?? null
    if (value && typeof value === "object") return Object.values(value).map(first).find(Boolean) ?? null
    return null
  }
  const message = first(data)
  if (message) return message
  if (status === 401) return "Your session has ended. Please log in again."
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return "Not found. It may have been deleted."
  if (status === 409) return "That conflicts with something already saved. Reload and try again."
  if (status === 429) return "Too many attempts. Wait a minute and try again."
  if (status >= 500) return "The server ran into a problem. Please try again."
  return "Something went wrong."
}

/** How long the Next.js server waits for Django before giving up. */
export const SERVER_TIMEOUT_MS = 15_000

/** A call that never got an answer: offline, the server is down, or it took too long. */
export function unreachable(err: unknown): ApiError {
  return err instanceof DOMException && err.name === "TimeoutError"
    ? new ApiError(504, "The server took too long to answer. Please try again.")
    : new ApiError(503, "Couldn't reach the server. Check your connection and try again.")
}

/** Field-by-field errors, for marking up a form rather than showing one sentence. */
export function fieldErrors(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === "detail") continue
    const message = Array.isArray(value) ? value.find((v) => typeof v === "string") : value
    if (typeof message === "string") out[key] = message
  }
  return out
}
