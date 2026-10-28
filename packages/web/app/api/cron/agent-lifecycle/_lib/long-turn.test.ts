import { describe, it, expect } from "vitest"
import { INTERACTIVE_HARD_TIMEOUT, INTERACTIVE_WARN_MINUTES } from "./constants"
import { interactiveTimeoutMessage, longTurnNotice } from "./long-turn"

/**
 * A 40-building enrichment on 2026-10-01 polled a job inside one turn, hit the
 * 25-minute hard timeout and was killed with no warning; the user typed
 * "continue". The limit is right for a runaway and wrong for sanctioned work
 * that is merely slow, so the person hears five minutes before the stop that
 * it is coming and can decide. On 2026-10-28 the limit went from 25 minutes to
 * 90, so slow but sanctioned work (enrichment, the pricing bot) can finish.
 */
describe("interactive turn limit", () => {
  it("lets an interactive turn run for 90 minutes", () => {
    expect(INTERACTIVE_HARD_TIMEOUT).toBe(90)
  })

  it("names the real limit when it stops a turn", () => {
    expect(interactiveTimeoutMessage()).toBe("Run exceeded 90 minute limit")
  })
})

describe("longTurnNotice", () => {
  it("warns five minutes before the hard stop", () => {
    expect(INTERACTIVE_WARN_MINUTES).toBe(INTERACTIVE_HARD_TIMEOUT - 5)
  })

  it("is quiet before the warning minute", () => {
    expect(longTurnNotice(INTERACTIVE_WARN_MINUTES - 1)).toBeNull()
  })

  it("names both numbers once the warning minute is reached", () => {
    const notice = longTurnNotice(INTERACTIVE_WARN_MINUTES)
    expect(notice).not.toBeNull()
    expect(notice!.title).toMatch(/85 minutes/)
    expect(notice!.body).toMatch(/90 minutes/)
  })
})
