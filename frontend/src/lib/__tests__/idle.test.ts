import { describe, expect, it } from "vitest"
import { IDLE_MS, WARN_MS, createIdleClock } from "@/lib/idle"

const MIN = 60 * 1000

/** A clock, a shared store (one device's localStorage) and a record of what happened. */
function setup(stored: number | null = null) {
  let time = 1_000_000_000
  const shared = { value: stored as number | null }
  const happened: string[] = []
  const make = () =>
    createIdleClock({
      now: () => time,
      store: {
        get: () => shared.value,
        set: (v) => (shared.value = v),
        clear: () => (shared.value = null),
      },
      events: {
        warn: () => happened.push("warn"),
        unwarn: () => happened.push("unwarn"),
        logOut: () => happened.push("logout"),
      },
    })
  return {
    make,
    shared,
    happened,
    wait: (ms: number) => (time += ms),
    get time() {
      return time
    },
  }
}

describe("idle logout", () => {
  it("never logs out someone who keeps working, all day", () => {
    const s = setup()
    const clock = s.make()
    clock.start()
    // A tap every 10 minutes for 12 hours, checked every 10 seconds.
    for (let minute = 0; minute < 12 * 60; minute += 10) {
      for (let i = 0; i < 60; i++) {
        s.wait(10_000)
        clock.check()
      }
      clock.activity()
    }
    expect(s.happened).not.toContain("logout")
  })

  it("warns a minute before, and logs out at 15 minutes of nothing", () => {
    const s = setup()
    const clock = s.make()
    clock.start()
    s.wait(IDLE_MS - WARN_MS - 1000)
    clock.check()
    expect(s.happened).toEqual([])
    s.wait(1000)
    clock.check()
    expect(s.happened).toEqual(["warn"])
    s.wait(WARN_MS)
    clock.check()
    expect(s.happened).toEqual(["warn", "logout"])
    // And forgets the stamp, so the next login starts fresh.
    expect(s.shared.value).toBeNull()
  })

  it("a tap after the warning keeps them in", () => {
    const s = setup()
    const clock = s.make()
    clock.start()
    s.wait(IDLE_MS - 30_000)
    clock.check()
    clock.activity()
    s.wait(IDLE_MS - 2 * MIN)
    clock.check()
    expect(s.happened).toEqual(["warn", "unwarn"])
  })

  it("background refreshes don't count: only taps, keys and scrolls do", () => {
    // Nothing but timer checks — as on a dashboard left open, refreshing itself.
    const s = setup()
    const clock = s.make()
    clock.start()
    for (let i = 0; i < 100; i++) {
      s.wait(10_000)
      clock.check()
    }
    expect(s.happened).toContain("logout")
  })

  it("logs out a device that slept past the limit as soon as it is opened", () => {
    const s = setup()
    s.make().start()
    s.wait(IDLE_MS + MIN)
    // The phone wakes and the page loads again: a new clock reads the shared stamp.
    expect(s.make().start()).toBe(false)
    expect(s.happened).toEqual(["logout"])
  })

  it("working in one tab keeps the other tabs logged in", () => {
    const s = setup()
    const tabA = s.make()
    const tabB = s.make()
    tabA.start()
    tabB.start()
    for (let i = 0; i < 6; i++) {
      s.wait(5 * MIN)
      tabA.activity()
      tabB.check()
    }
    expect(s.happened).toEqual([])
  })

  it("a first visit with nothing recorded starts the clock rather than logging out", () => {
    const s = setup(null)
    expect(s.make().start()).toBe(true)
    expect(s.shared.value).toBe(s.time)
  })
})
