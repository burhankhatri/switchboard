import { describe, it, expect } from "vitest"
import { notificationsPollInterval } from "./useNotificationsQuery"

/**
 * These assert a cost constraint, not a UX preference.
 *
 * Neon suspends a compute after five minutes without a query. A badge that
 * polls on a bare interval keeps the database awake around the clock — that is
 * exactly what `agent-lifecycle` running every 60s did, and it billed roughly
 * $18 for a month of finding nothing. The failure is silent: nothing breaks,
 * the invoice just arrives. So the interval is a pure function and it is tested.
 */
describe("notificationsPollInterval", () => {
  it("does not poll when the tab is hidden", () => {
    expect(notificationsPollInterval({ visible: false, focused: false })).toBe(false)
  })

  it("does not poll when the tab is visible but unfocused", () => {
    // A background tab left open overnight is the $18 scenario. Being visible
    // on a second monitor is not evidence anybody is there.
    expect(notificationsPollInterval({ visible: true, focused: false })).toBe(false)
  })

  it("polls while someone is actually looking at the tab", () => {
    const interval = notificationsPollInterval({ visible: true, focused: true })
    expect(interval).toBeTypeOf("number")
    expect(interval).toBeGreaterThan(0)
  })

  it("never polls faster than 30 seconds", () => {
    // A focused tab is a real user whose other requests already keep the
    // compute awake, so polling here is not the expensive part — but a tight
    // interval would still multiply queries for no benefit.
    const interval = notificationsPollInterval({ visible: true, focused: true })
    expect(interval as number).toBeGreaterThanOrEqual(30_000)
  })

  it("stops polling as soon as the tab stops being focused", () => {
    // The regression to guard against is someone "simplifying" this to a
    // constant. If any input combination other than visible+focused returns a
    // number, the database never suspends.
    const combos = [
      { visible: false, focused: false },
      { visible: false, focused: true },
      { visible: true, focused: false },
    ]
    for (const combo of combos) {
      expect(notificationsPollInterval(combo)).toBe(false)
    }
  })
})
