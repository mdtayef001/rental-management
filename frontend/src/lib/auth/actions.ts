"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS, errorMessage } from "@/lib/api/errors"
import { isAppRoute } from "./roles"
import { createSession, deleteSession } from "./session"

// `FormData.get` returns null for a field that isn't on the form, so every optional
// field has to accept null rather than only undefined.
const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().nullish(),
})

export interface LoginState {
  error?: string
  email?: string
}

/**
 * Logs in and sets the session cookies.
 *
 * The error message is deliberately the same whether the email is unknown or the password
 * is wrong, so the form can't be used to find out which accounts exist.
 */
export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    next: form.get("next"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") }
  }
  const { email, password, next } = parsed.data

  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again.", email }
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) return { error: "That email and password don't match.", email }
    return { error: errorMessage(data, res.status), email }
  }

  await createSession({ access: data.access, refresh: data.refresh })
  // Only an in-app path, so `?next=` can't be used to bounce someone to another site.
  redirect(next && isAppRoute(next) ? next : "/")
}

export async function logout() {
  await deleteSession()
  redirect("/login")
}
