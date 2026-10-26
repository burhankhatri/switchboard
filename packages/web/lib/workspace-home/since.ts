/**
 * "Since you were last here" — pure, so the server computes it and the client
 * phrases it from the same definitions.
 */

/** A first visit has no last visit; a week is enough to say what this place does. */
export const FIRST_VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * lastSeenAt only moves if it is at least this old. Home refetches on window
 * focus; without the debounce, glancing at another tab and back would reset
 * the summary while the member was still reading it.
 */
export const LAST_SEEN_DEBOUNCE_MS = 5 * 60 * 1000

export const MAX_HIGHLIGHTS = 5

export function sinceFor(lastSeenAt: Date | null, now: Date): Date {
  return lastSeenAt ?? new Date(now.getTime() - FIRST_VISIT_WINDOW_MS)
}

export function shouldTouchLastSeen(lastSeenAt: Date | null, now: Date): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_DEBOUNCE_MS
}

export interface SinceCounts {
  runs: number
  failingJobs: number
  filesCommitted: number
  widgetsUpdated: number
  chatsShared: number
  jobChanges: number
  memberChanges: number
}

interface CountableEvent {
  kind: string
  jobId: string | null
}

export function countSince(events: CountableEvent[], widgetsUpdated: number): SinceCounts {
  const failing = new Set<string>()
  const counts: SinceCounts = {
    runs: 0,
    failingJobs: 0,
    filesCommitted: 0,
    widgetsUpdated,
    chatsShared: 0,
    jobChanges: 0,
    memberChanges: 0,
  }
  for (const e of events) {
    switch (e.kind) {
      case "run_completed":
        counts.runs++
        break
      case "run_failed":
        counts.runs++
        // Jobs, not failures: three failed runs of one job is one problem.
        if (e.jobId) failing.add(e.jobId)
        break
      case "files_committed":
        counts.filesCommitted++
        break
      case "chat_shared":
        counts.chatsShared++
        break
      case "member_joined":
      case "member_left":
        counts.memberChanges++
        break
      default:
        if (e.kind.startsWith("job_")) counts.jobChanges++
    }
  }
  counts.failingJobs = failing.size
  return counts
}

export function isEmpty(counts: SinceCounts): boolean {
  return Object.values(counts).every((n) => n === 0)
}

/**
 * Up to five events worth reading first: failures, then newly shared chats,
 * then whatever is newest. Input is newest first and stays so within each
 * group.
 */
export function pickHighlights<T extends { id: string; kind: string }>(
  events: T[],
  max = MAX_HIGHLIGHTS
): T[] {
  const rank = (kind: string) => (kind === "run_failed" ? 0 : kind === "chat_shared" ? 1 : 2)
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.kind) - rank(b.e.kind) || a.i - b.i)
    .slice(0, max)
    .map(({ e }) => e)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "6 runs, 1 failing job, 2 widgets updated" — the failing part first. */
export function describeCounts(c: SinceCounts): string {
  const parts: string[] = []
  if (c.failingJobs) parts.push(plural(c.failingJobs, "failing job"))
  if (c.runs) parts.push(plural(c.runs, "run"))
  if (c.widgetsUpdated) parts.push(`${plural(c.widgetsUpdated, "widget")} updated`)
  if (c.filesCommitted) parts.push(plural(c.filesCommitted, "file change"))
  if (c.chatsShared) parts.push(`${plural(c.chatsShared, "chat")} shared`)
  if (c.jobChanges) parts.push(plural(c.jobChanges, "job change"))
  if (c.memberChanges) parts.push(plural(c.memberChanges, "membership change"))
  return parts.join(", ")
}
