import "server-only"
import { cookies } from "next/headers"
import { ACCESS_COOKIE } from "@/lib/auth/session"
import { API_URL } from "./config"
import { ApiError, SERVER_TIMEOUT_MS, errorMessage, unreachable } from "./errors"

interface Options {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  /** Use this access token instead of the logged-in user's (e.g. right after login). */
  token?: string | null
}

/** Calls Django as the logged-in user. Throws ApiError with a readable message on failure. */
export async function api<T>(path: string, { method = "GET", body, token }: Options = {}): Promise<T> {
  const access = token === undefined ? (await cookies()).get(ACCESS_COOKIE)?.value : token
  let res: Response
  try {
    res = await fetch(`${API_URL}/${path.replace(/^\//, "")}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(access && { Authorization: `Bearer ${access}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
  } catch (err) {
    throw unreachable(err)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status))
  return data as T
}
