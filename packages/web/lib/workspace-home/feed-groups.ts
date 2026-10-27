import type { FeedEvent } from "./feed"

/**
 * Collapse runs of the same thing done by the same person into one line.
 *
 * An agent building a home page pins eight widgets in a minute, and the feed
 * read as eight identical rows that pushed everything else off the page. Runs
 * and failures are never merged: each is its own news.
 */

const GROUPABLE: Record<string, (n: number) => string> = {
  widget_created: (n) => `Pinned ${n} widgets to the home page`,
  widget_updated: (n) => `Updated ${n} widgets on the home page`,
  widget_removed: (n) => `Removed ${n} widgets from the home page`,
  files_committed: (n) => `Made ${n} changes to the workspace files`,
}

/** Events further apart than this are separate sessions, even if alike. */
const WINDOW_MS = 2 * 60 * 60 * 1000

export interface FeedGroup {
  id: string
  /** The newest event; its time, kind and actor stand for the group. */
  head: FeedEvent
  /** Every event in the group, newest first. A single event is a group of one. */
  events: FeedEvent[]
  summary: string
}

export function groupFeed(events: FeedEvent[]): FeedGroup[] {
  const groups: FeedGroup[] = []
  for (const e of events) {
    const last = groups[groups.length - 1]
    const prev = last?.events[last.events.length - 1]
    const joins =
      last &&
      prev &&
      GROUPABLE[e.kind] &&
      e.kind === last.head.kind &&
      e.actor?.id !== undefined &&
      e.actor?.id === last.head.actor?.id &&
      Math.abs(Date.parse(prev.createdAt) - Date.parse(e.createdAt)) <= WINDOW_MS
    if (joins) {
      last.events.push(e)
      last.summary = GROUPABLE[e.kind](last.events.length)
    } else {
      groups.push({ id: e.id, head: e, events: [e], summary: e.summary })
    }
  }
  return groups
}
