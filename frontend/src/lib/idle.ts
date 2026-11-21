/**
 * The idle clock behind the 15-minute logout (see components/idle-logout.tsx).
 *
 * Kept free of React and the DOM so it can be tested with a fake clock: what counts as
 * idle, when to warn and when to log out are decided here, and the component only wires
 * it to real events, timers and localStorage.
 */
export const IDLE_MS = 15 * 60 * 1000
/** How long before the logout to warn, so someone mid-thought can tap and stay. */
export const WARN_MS = 60 * 1000
/** Shared by every tab on the device, so working in one keeps the others logged in. */
export const IDLE_KEY = "rm-last-active"

export interface Store {
  get(): number | null
  set(value: number): void
  clear(): void
}

export interface IdleEvents {
  warn(): void
  /** Activity came back after a warning. */
  unwarn(): void
  logOut(): void
}

export function createIdleClock({
  store,
  events,
  now = Date.now,
  idleMs = IDLE_MS,
  warnMs = WARN_MS,
}: {
  store: Store
  events: IdleEvents
  now?: () => number
  idleMs?: number
  warnMs?: number
}) {
  /** This tab's own last activity, for when storage is blocked. 0 until something happens. */
  let memory = 0
  let lastWrite = 0
  let warned = false
  let done = false

  function lastActive(): number | null {
    const latest = Math.max(store.get() ?? 0, memory)
    return latest > 0 ? latest : null
  }

  function mark(at: number) {
    memory = at
    store.set(at)
  }

  function logOut() {
    if (done) return
    done = true
    // Forget the stamp, so the next login starts fresh instead of tripping over it.
    store.clear()
    events.logOut()
  }

  return {
    /**
     * The page opened. A device that slept past the limit logs out now; otherwise opening
     * the page is activity. Returns false when it logged out.
     */
    start(): boolean {
      const last = lastActive()
      if (last !== null && now() - last > idleMs) {
        logOut()
        return false
      }
      mark(now())
      lastWrite = now()
      return true
    },

    /** A tap, click, key or scroll. */
    activity() {
      const at = now()
      // Written at most every few seconds: a scroll fires dozens of events a second.
      if (at - lastWrite > 5_000) {
        mark(at)
        lastWrite = at
      } else {
        memory = at
      }
      if (warned) {
        warned = false
        events.unwarn()
      }
    },

    /** Run on a timer, and when the page becomes visible again. */
    check() {
      if (done) return
      const idle = now() - (lastActive() ?? now())
      if (idle >= idleMs) logOut()
      else if (idle >= idleMs - warnMs && !warned) {
        warned = true
        events.warn()
      }
    },
  }
}
