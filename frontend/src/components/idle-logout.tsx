"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { t } from "@/lib/i18n"
import { IDLE_KEY, IDLE_MS, WARN_MS, createIdleClock } from "@/lib/idle"

export { IDLE_KEY } from "@/lib/idle"

/**
 * Logs out after 15 minutes with nobody using the app.
 *
 * While someone is working they are never logged out: the server renews the login for as
 * long as it is used (see proxy.ts). This is the other half — a counter PC or a phone left
 * alone shouldn't stay open to whoever walks up to it.
 *
 * "Using" means a person did something: a tap, a click, a key (a USB barcode scanner types,
 * so scanning counts), a scroll. Background refreshes don't count, or a dashboard left open
 * would keep itself logged in forever.
 *
 * The last-used time is kept in localStorage, so every tab on the device shares it, and it
 * survives the device sleeping: a phone woken after an hour in a pocket logs out at once
 * instead of showing the last screen. The rules themselves are in lib/idle.ts.
 */
const CHECK_EVERY_MS = 10 * 1000
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const

const store = {
  get() {
    try {
      return Number(localStorage.getItem(IDLE_KEY)) || null
    } catch {
      return null
    }
  },
  set(value: number) {
    try {
      localStorage.setItem(IDLE_KEY, String(value))
    } catch {
      // Storage blocked: the tab still counts its own activity.
    }
  },
  clear() {
    try {
      localStorage.removeItem(IDLE_KEY)
    } catch {
      // Nothing to clear.
    }
  },
}

export function IdleLogout({ idleMs = IDLE_MS }: { idleMs?: number }) {
  useEffect(() => {
    const clock = createIdleClock({
      store,
      idleMs,
      events: {
        warn: () =>
          toast.warning(t("You'll be logged out in a minute. Tap anywhere to stay."), {
            id: "idle-logout",
            duration: WARN_MS,
          }),
        unwarn: () => toast.dismiss("idle-logout"),
        // A full page load: /logout clears the cookies on the server and the query cache
        // goes with the document, so nothing from this session is left on screen.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point
        logOut: () => (window.location.href = "/logout?reason=idle"),
      },
    })
    if (!clock.start()) return

    const onActivity = () => clock.activity()
    const onVisible = () => document.visibilityState === "visible" && clock.check()
    EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true, capture: true }))
    document.addEventListener("visibilitychange", onVisible)
    const timer = window.setInterval(clock.check, CHECK_EVERY_MS)
    return () => {
      EVENTS.forEach((name) => window.removeEventListener(name, onActivity, { capture: true }))
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(timer)
    }
  }, [idleMs])

  return null
}
