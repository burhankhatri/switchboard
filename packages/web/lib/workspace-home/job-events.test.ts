import { describe, it, expect } from "vitest"
import { jobTransitionEvents } from "./job-events"

const base = { name: "Weekly Leads", isDraft: false, enabled: true, approvedAt: new Date() }

describe("jobTransitionEvents", () => {
  it("says nothing while a job is still a draft", () => {
    expect(jobTransitionEvents({ ...base, isDraft: true }, { ...base, isDraft: true })).toEqual([])
  })

  it("records a finished draft as created, once", () => {
    expect(jobTransitionEvents({ ...base, isDraft: true }, base)).toEqual([
      { kind: "job_created", summary: "Set up Weekly Leads" },
    ])
  })

  it("records approval without a separate enable line", () => {
    const before = { ...base, approvedAt: null, enabled: false }
    expect(jobTransitionEvents(before, base)).toEqual([
      { kind: "job_approved", summary: "Approved Weekly Leads" },
    ])
  })

  it("records pausing and resuming", () => {
    expect(jobTransitionEvents(base, { ...base, enabled: false })[0].kind).toBe("job_disabled")
    expect(jobTransitionEvents({ ...base, enabled: false }, base)[0].kind).toBe("job_enabled")
  })

  it("records nothing for an edit that changes no state", () => {
    expect(jobTransitionEvents(base, { ...base, name: "Renamed" })).toEqual([])
  })
})
