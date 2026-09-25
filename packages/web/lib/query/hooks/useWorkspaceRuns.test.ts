import { describe, it, expect } from "vitest"
import { hasActiveRun, workspaceRunsPollInterval } from "./useWorkspaceRuns"

/**
 * The runs list polls only while something is in flight. Neon suspends an idle
 * compute after five minutes, so a list that polled on a bare interval would
 * keep the database awake for every open tab — silently, until the invoice.
 */
describe("workspaceRunsPollInterval", () => {
  it("does not poll once every run has settled", () => {
    expect(workspaceRunsPollInterval([{ status: "completed" }, { status: "failed" }])).toBe(false)
  })

  it("does not poll an empty list", () => {
    expect(workspaceRunsPollInterval([])).toBe(false)
  })

  it("polls while a run is pending or running", () => {
    expect(workspaceRunsPollInterval([{ status: "pending" }])).toBeGreaterThan(0)
    expect(workspaceRunsPollInterval([{ status: "running" }])).toBeGreaterThan(0)
  })
})

describe("hasActiveRun", () => {
  it("is what the rail's Runs dot shows", () => {
    expect(hasActiveRun([{ status: "running" }, { status: "completed" }])).toBe(true)
    expect(hasActiveRun([{ status: "completed" }])).toBe(false)
  })
})
