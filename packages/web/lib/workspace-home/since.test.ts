import { describe, it, expect } from "vitest"
import {
  sinceFor,
  shouldTouchLastSeen,
  countSince,
  isEmpty,
  pickHighlights,
  describeCounts,
  FIRST_VISIT_WINDOW_MS,
  LAST_SEEN_DEBOUNCE_MS,
} from "./since"

const now = new Date("2026-10-26T12:00:00Z")

describe("sinceFor", () => {
  it("covers the last week on a first visit", () => {
    expect(sinceFor(null, now).getTime()).toBe(now.getTime() - FIRST_VISIT_WINDOW_MS)
  })

  it("starts from the last visit otherwise", () => {
    const last = new Date("2026-10-21T09:00:00Z")
    expect(sinceFor(last, now)).toBe(last)
  })
})

describe("shouldTouchLastSeen", () => {
  it("records a first visit", () => {
    expect(shouldTouchLastSeen(null, now)).toBe(true)
  })

  it("does not move on a refetch moments later", () => {
    // Otherwise refocusing the tab would wipe the summary mid-read.
    const justNow = new Date(now.getTime() - 60_000)
    expect(shouldTouchLastSeen(justNow, now)).toBe(false)
  })

  it("moves once the debounce has passed", () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - LAST_SEEN_DEBOUNCE_MS), now)).toBe(true)
  })
})

describe("countSince", () => {
  it("counts failing jobs, not failed runs", () => {
    const c = countSince(
      [
        { kind: "run_failed", jobId: "j1" },
        { kind: "run_failed", jobId: "j1" },
        { kind: "run_completed", jobId: "j2" },
        { kind: "chat_shared", jobId: null },
        { kind: "job_approved", jobId: "j3" },
      ],
      2
    )
    expect(c).toMatchObject({ runs: 3, failingJobs: 1, chatsShared: 1, jobChanges: 1, widgetsUpdated: 2 })
  })

  it("is empty when nothing happened", () => {
    expect(isEmpty(countSince([], 0))).toBe(true)
  })
})

describe("pickHighlights", () => {
  it("puts failures first, then shares, then the newest", () => {
    const events = [
      { id: "a", kind: "files_committed" },
      { id: "b", kind: "chat_shared" },
      { id: "c", kind: "run_completed" },
      { id: "d", kind: "run_failed" },
      { id: "e", kind: "run_failed" },
      { id: "f", kind: "member_joined" },
    ]
    expect(pickHighlights(events).map((e) => e.id)).toEqual(["d", "e", "b", "a", "c"])
  })
})

describe("describeCounts", () => {
  it("leads with what is failing", () => {
    const c = countSince(
      [
        { kind: "run_failed", jobId: "j1" },
        ...Array.from({ length: 5 }, () => ({ kind: "run_completed", jobId: "j2" })),
        { kind: "chat_shared", jobId: null },
      ],
      2
    )
    expect(describeCounts(c)).toBe("1 failing job, 6 runs, 2 widgets updated, 1 chat shared")
  })
})
