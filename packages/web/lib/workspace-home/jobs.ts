import { describeInterval } from "@/lib/scheduled-jobs/agent-proposal"

export type JobHealthState =
  | "awaiting_approval"
  | "paused"
  | "running"
  | "failing"
  | "healthy"
  | "not_run_yet"

export interface JobHealth {
  state: JobHealthState
  /** Consecutive failures, so "failing" and "paused" can say how badly. */
  failures: number
}

interface JobHealthInput {
  enabled: boolean
  approvedAt: Date | string | null
  consecutiveFailures: number
  lastRunStatus: string | null
}

/**
 * One word for whether a job is working, for someone who did not set it up.
 *
 * Paused outranks failing: a job that is off is not going to fix itself, and
 * the three-strikes auto-pause is the common way a job ends up off. `failures`
 * still carries the count so the card can say "paused after 3 failures"
 * rather than looking like someone chose to switch it off.
 */
export function jobHealth(job: JobHealthInput): JobHealth {
  const failures = job.consecutiveFailures
  if (!job.approvedAt) return { state: "awaiting_approval", failures }
  if (!job.enabled) return { state: "paused", failures }
  if (job.lastRunStatus === "running" || job.lastRunStatus === "pending") {
    return { state: "running", failures }
  }
  if (job.lastRunStatus === "error") return { state: "failing", failures: Math.max(failures, 1) }
  if (job.lastRunStatus === "completed") return { state: "healthy", failures }
  return { state: "not_run_yet", failures }
}

/** "Every week", or what sets an incoming job off — never a cron string. */
export function scheduleInWords(job: { triggerType: string; intervalMinutes: number }): string {
  if (job.triggerType === "incoming") return "When its webhook is called"
  const text = describeInterval(job.intervalMinutes)
  return text.charAt(0).toUpperCase() + text.slice(1)
}
