import type { WorkspaceEventKind } from "./events"

interface JobState {
  name: string
  isDraft: boolean
  enabled: boolean
  approvedAt: Date | null
}

export interface JobEvent {
  kind: WorkspaceEventKind
  summary: string
}

/**
 * The feed lines a job update produces, from its state before and after.
 *
 * Derived from the two states rather than from the request body because the
 * body does not say what changed: approving also enables, and finishing a
 * draft can carry an `enabled` that matches what was already there. Comparing
 * states records each transition once and nothing for a no-op save.
 */
export function jobTransitionEvents(before: JobState, after: JobState): JobEvent[] {
  // A draft is still being filled in; nobody else should hear about it until
  // it exists, and then only as "created".
  if (after.isDraft) return []
  if (before.isDraft) return [{ kind: "job_created", summary: `Set up ${after.name}` }]

  const events: JobEvent[] = []
  if (!before.approvedAt && after.approvedAt) {
    events.push({ kind: "job_approved", summary: `Approved ${after.name}` })
    // Approval switches the job on as part of the same act; a second line
    // saying it was enabled would read as two separate decisions.
    return events
  }
  if (before.enabled !== after.enabled) {
    events.push(
      after.enabled
        ? { kind: "job_enabled", summary: `Resumed ${after.name}` }
        : { kind: "job_disabled", summary: `Paused ${after.name}` }
    )
  }
  return events
}
