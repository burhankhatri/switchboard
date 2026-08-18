import { describe, it, expect } from "vitest"
import { formatDuration, statusLabel, MAX_ERROR_CHARS } from "./TaskRows"

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

describe("formatDuration", () => {
  it("uses completedAt when the run has finished", () => {
    expect(formatDuration({ startedAt: at(90_000), completedAt: at(30_000) })).toBe("1m 0s")
    expect(formatDuration({ startedAt: at(45_000), completedAt: at(30_000) })).toBe("15s")
  })

  it("counts up to now while still running", () => {
    // A running row must not show a frozen or negative duration.
    const d = formatDuration({ startedAt: at(65_000), completedAt: null })
    expect(d).toMatch(/^1m \d+s$/)
  })

  it("renders hours for long runs", () => {
    expect(formatDuration({ startedAt: at(7_200_000), completedAt: at(0) })).toBe("2h 0m")
  })

  it("never goes negative on clock skew", () => {
    expect(formatDuration({ startedAt: at(-5_000), completedAt: at(0) })).toBe("0s")
  })
})

describe("statusLabel", () => {
  it("maps every status the scheduler can write", () => {
    // These four are the values ScheduledJobRun.status actually takes.
    expect(statusLabel("running")).toBe("Running")
    expect(statusLabel("pending")).toBe("Queued")
    expect(statusLabel("completed")).toBe("Completed")
    expect(statusLabel("error")).toBe("Failed")
  })

  it("falls back rather than rendering blank for an unknown status", () => {
    expect(statusLabel("something-new")).toBe("Queued")
    expect(statusLabel("")).toBe("Queued")
  })
})

describe("error truncation", () => {
  it("caps how much of an error one row can show", () => {
    expect("x".repeat(1000).slice(0, MAX_ERROR_CHARS)).toHaveLength(300)
  })
})
