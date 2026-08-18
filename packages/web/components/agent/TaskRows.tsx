"use client"

import { AlertCircle, CheckCircle2, Clock, GitPullRequest, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface TaskRun {
  id: string
  status: string
  startedAt: string
  completedAt: string | null
  commitCount: number
  prUrl: string | null
  error: string | null
  jobName?: string
}

const STATE = {
  running:   { Icon: Loader2,      cls: "text-primary",          spin: true,  label: "Running" },
  pending:   { Icon: Clock,        cls: "text-muted-foreground", spin: false, label: "Queued" },
  completed: { Icon: CheckCircle2, cls: "text-primary",          spin: false, label: "Completed" },
  error:     { Icon: AlertCircle,  cls: "text-destructive",      spin: false, label: "Failed" },
} as const

/** Status -> the label shown to a human. Unknown states read as queued. */
export function statusLabel(status: string): string {
  return (STATE[status as keyof typeof STATE] ?? STATE.pending).label
}

/** Errors are truncated so one bad run cannot blow out the list. */
export const MAX_ERROR_CHARS = 300

export function formatDuration(run: Pick<TaskRun, "startedAt" | "completedAt">): string {
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now()
  const secs = Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  return m < 60 ? `${m}m ${secs % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Scheduled runs as status rows.
 *
 * A failed run shows its error inline rather than behind a click: a cron that
 * has been failing silently is the failure mode that actually costs you, and it
 * should be visible without drilling in.
 */
export function TaskRows({ runs }: { runs: TaskRun[] }) {
  if (runs.length === 0) {
    return <p className="px-2 py-3 text-xs text-muted-foreground">No runs yet.</p>
  }

  return (
    <ul className="space-y-1">
      {runs.map((run) => {
        const s = STATE[run.status as keyof typeof STATE] ?? STATE.pending
        return (
          <li
            key={run.id}
            className="flex items-start gap-2 rounded-lg border border-border bg-card/50 px-2.5 py-2"
          >
            <s.Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.cls, s.spin && "animate-spin")} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-xs text-foreground">
                  {run.jobName ?? s.label}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {formatDuration(run)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                <span>{s.label}</span>
                {run.commitCount > 0 && <span>{run.commitCount} commit{run.commitCount === 1 ? "" : "s"}</span>}
                {run.prUrl && (
                  <a
                    href={run.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 underline decoration-dotted hover:text-foreground"
                  >
                    <GitPullRequest className="h-2.5 w-2.5" /> PR
                  </a>
                )}
              </div>
              {run.error && (
                <p className="mt-1 rounded bg-destructive/10 px-1.5 py-1 text-[10px] leading-snug text-destructive break-words">
                  {run.error.slice(0, MAX_ERROR_CHARS)}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
