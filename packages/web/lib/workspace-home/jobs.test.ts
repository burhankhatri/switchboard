import { describe, it, expect } from "vitest"
import { jobHealth, scheduleInWords } from "./jobs"

const approved = new Date()

describe("jobHealth", () => {
  it("is healthy when the last run completed", () => {
    expect(
      jobHealth({ enabled: true, approvedAt: approved, consecutiveFailures: 0, lastRunStatus: "completed" })
    ).toEqual({ state: "healthy", failures: 0 })
  })

  it("is failing with a count when the last run errored", () => {
    expect(
      jobHealth({ enabled: true, approvedAt: approved, consecutiveFailures: 2, lastRunStatus: "error" })
    ).toEqual({ state: "failing", failures: 2 })
  })

  it("reports paused, with the failures that caused it, once auto-disabled", () => {
    expect(
      jobHealth({ enabled: false, approvedAt: approved, consecutiveFailures: 3, lastRunStatus: "error" })
    ).toEqual({ state: "paused", failures: 3 })
  })

  it("puts an unapproved job in its own state, whatever else is true", () => {
    expect(
      jobHealth({ enabled: false, approvedAt: null, consecutiveFailures: 0, lastRunStatus: null }).state
    ).toBe("awaiting_approval")
  })

  it("distinguishes a running job and one that has never run", () => {
    const base = { enabled: true, approvedAt: approved, consecutiveFailures: 0 }
    expect(jobHealth({ ...base, lastRunStatus: "running" }).state).toBe("running")
    expect(jobHealth({ ...base, lastRunStatus: null }).state).toBe("not_run_yet")
  })
})

describe("scheduleInWords", () => {
  it("says the interval in words", () => {
    expect(scheduleInWords({ triggerType: "interval", intervalMinutes: 10080 })).toBe("Every week")
    expect(scheduleInWords({ triggerType: "interval", intervalMinutes: 360 })).toBe("Every 6 hours")
  })

  it("explains a webhook job instead of showing its placeholder interval", () => {
    expect(scheduleInWords({ triggerType: "incoming", intervalMinutes: 0 })).toBe(
      "When its webhook is called"
    )
  })
})
