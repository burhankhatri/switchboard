import { describe, it, expect } from "vitest"
import type { FeedEvent } from "./feed"
import { groupFeed } from "./feed-groups"

let n = 0
const ev = (kind: string, actor: string | null, minutesAgo: number, summary = kind): FeedEvent => ({
  id: `e${n++}`,
  kind: kind as FeedEvent["kind"],
  summary,
  createdAt: new Date(Date.UTC(2026, 9, 26, 12, 0) - minutesAgo * 60_000).toISOString(),
  actor: actor ? { id: actor, name: actor, image: null } : null,
  jobId: null,
  runId: null,
  chatId: null,
  widgetId: null,
  meta: null,
})

describe("groupFeed", () => {
  it("folds a burst of pins by one person into one line", () => {
    const groups = groupFeed([
      ev("widget_created", "burhan", 1, "Pinned Timeline to the home page"),
      ev("widget_created", "burhan", 2, "Pinned Funnel to the home page"),
      ev("widget_created", "burhan", 3, "Pinned KPIs to the home page"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].summary).toBe("Pinned 3 widgets to the home page")
    expect(groups[0].events.map((e) => e.summary)).toEqual([
      "Pinned Timeline to the home page",
      "Pinned Funnel to the home page",
      "Pinned KPIs to the home page",
    ])
  })

  it("keeps different people, different kinds and distant times apart", () => {
    const groups = groupFeed([
      ev("widget_created", "burhan", 1),
      ev("widget_created", "wayne", 2),
      ev("files_committed", "wayne", 3),
      ev("files_committed", "wayne", 300),
    ])
    expect(groups.map((g) => g.events.length)).toEqual([1, 1, 1, 1])
  })

  it("never merges runs, which are each their own news", () => {
    const groups = groupFeed([ev("run_failed", null, 1), ev("run_failed", null, 2)])
    expect(groups).toHaveLength(2)
  })
})
