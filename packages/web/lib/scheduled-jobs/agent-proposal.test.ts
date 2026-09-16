import { describe, it, expect } from "vitest"
import {
  normalizeInterval,
  describeInterval,
  MIN_INTERVAL_MINUTES,
} from "./agent-proposal"

describe("normalizeInterval", () => {
  it("accepts the intervals an agent would realistically propose", () => {
    expect(normalizeInterval(1440)).toEqual({ ok: true, minutes: 1440 })
    expect(normalizeInterval(10080)).toEqual({ ok: true, minutes: 10080 })
    expect(normalizeInterval(MIN_INTERVAL_MINUTES)).toEqual({ ok: true, minutes: 30 })
  })

  it("refuses anything the 30-minute cron cannot honour", () => {
    // The form still offers 10 and 15 for historical reasons. There is no
    // reason to let an agent mint a schedule the scheduler cannot keep.
    const below = normalizeInterval(10)
    expect(below.ok).toBe(false)
    expect(below.ok === false && below.reason).toMatch(/30 minutes/)
  })

  it("refuses a non-number instead of coercing it to a schedule", () => {
    for (const bad of ["weekly", null, undefined, {}, NaN, Infinity]) {
      expect(normalizeInterval(bad).ok).toBe(false)
    }
  })

  it("tells the model to ask rather than guess", () => {
    const bad = normalizeInterval("weekly")
    expect(bad.ok === false && bad.reason).toMatch(/ask the user/i)
  })

  it("floors a fractional interval rather than rejecting it", () => {
    expect(normalizeInterval(1440.7)).toEqual({ ok: true, minutes: 1440 })
  })

  it("refuses an interval longer than a year", () => {
    expect(normalizeInterval(600_000).ok).toBe(false)
  })
})

describe("describeInterval", () => {
  it("reads as English in the notification and the tool's reply", () => {
    expect(describeInterval(10080)).toBe("every week")
    expect(describeInterval(20160)).toBe("every 2 weeks")
    expect(describeInterval(1440)).toBe("every day")
    expect(describeInterval(2880)).toBe("every 2 days")
    expect(describeInterval(60)).toBe("every hour")
    expect(describeInterval(360)).toBe("every 6 hours")
    expect(describeInterval(30)).toBe("every 30 minutes")
  })
})
