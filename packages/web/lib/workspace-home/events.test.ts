import { describe, it, expect, vi, beforeEach } from "vitest"

const { workspaceEvent } = vi.hoisted(() => ({
  workspaceEvent: { create: vi.fn() },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { workspaceEvent } }))

import {
  recordWorkspaceEvent,
  recordWorkspaceEventAsync,
  clampSummary,
  SUMMARY_MAX,
} from "./events"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  workspaceEvent.create.mockReset().mockResolvedValue({})
})

describe("recordWorkspaceEvent", () => {
  it("writes the event with its subject ids", async () => {
    await recordWorkspaceEvent({
      workspaceId: "w1",
      kind: "run_failed",
      summary: "Weekly Lead Run failed",
      jobId: "j1",
      runId: "r1",
    })
    const { data } = workspaceEvent.create.mock.calls[0][0]
    expect(data).toMatchObject({
      workspaceId: "w1",
      kind: "run_failed",
      summary: "Weekly Lead Run failed",
      jobId: "j1",
      runId: "r1",
      actorUserId: null,
      chatId: null,
    })
  })

  it("does nothing for something outside any workspace", async () => {
    await recordWorkspaceEvent({ workspaceId: null, kind: "job_created", summary: "x" })
    expect(workspaceEvent.create).not.toHaveBeenCalled()
  })

  it("never throws when the insert fails", async () => {
    // The action that caused the event has already happened; failing its
    // request because the feed could not be written would be worse than a
    // missing feed line.
    workspaceEvent.create.mockRejectedValue(new Error("db down"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      recordWorkspaceEvent({ workspaceId: "w1", kind: "job_created", summary: "x" })
    ).resolves.toBeUndefined()
    spy.mockRestore()
  })

  it("the async form swallows failures too", async () => {
    workspaceEvent.create.mockRejectedValue(new Error("db down"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      recordWorkspaceEventAsync({ workspaceId: "w1", kind: "job_created", summary: "x" })
    ).not.toThrow()
    await flush()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("clampSummary", () => {
  it("flattens whitespace and caps length", () => {
    const long = `failed:\n${"x".repeat(1000)}`
    const out = clampSummary(long)
    expect(out.length).toBe(SUMMARY_MAX)
    expect(out.endsWith("…")).toBe(true)
    expect(out).not.toContain("\n")
  })

  it("leaves a short summary alone", () => {
    expect(clampSummary("Job created")).toBe("Job created")
  })
})
