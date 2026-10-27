"use client"

import { useState } from "react"
import { CalendarClock, ChevronDown, MessageSquare, Settings2 } from "lucide-react"
import type { HomeJob } from "@/lib/workspace-home/home"
import type { JobHealthState } from "@/lib/workspace-home/jobs"
import { cn } from "@/lib/utils"
import { ago } from "./time"

const HEALTH: Record<JobHealthState, { label: string; dot: string }> = {
  healthy: { label: "Working", dot: "bg-green" },
  failing: { label: "Failing", dot: "bg-destructive" },
  paused: { label: "Paused", dot: "bg-ink-3" },
  running: { label: "Running now", dot: "bg-primary animate-pulse" },
  not_run_yet: { label: "Not run yet", dot: "bg-line-strong" },
  awaiting_approval: { label: "Awaiting approval", dot: "bg-primary/50" },
}

function healthText(job: HomeJob): string {
  const { state, failures } = job.health
  if (state === "failing" && failures > 1) return `Failing (${failures} in a row)`
  if (state === "paused" && failures >= 3) return `Paused after ${failures} failures`
  return HEALTH[state].label
}

function JobCard({
  job,
  onOpenChat,
  onManage,
}: {
  job: HomeJob
  onOpenChat: (chatId: string) => void
  onManage: (job: HomeJob) => void
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  const last = job.lastRun
  return (
    <li className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", HEALTH[job.health.state].dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13px] font-medium text-ink">{job.name}</span>
            <span className="text-[12px] text-ink-3">{job.schedule}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {healthText(job)}
            {last && ` · last ran ${ago(last.startedAt)}`}
            {` · set up by ${job.canManage ? "you" : (job.author.name ?? "a member")}`}
          </p>
          {last?.status === "error" && last.error && (
            <p className="mt-1 line-clamp-2 text-[12px] text-destructive">{last.error}</p>
          )}
          {showPrompt && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-inset p-2.5 text-[12px] leading-relaxed text-ink-2">
              {job.prompt}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:bg-hover cursor-pointer"
            aria-expanded={showPrompt}
          >
            What it does
            <ChevronDown className={cn("h-3 w-3 transition-transform", showPrompt && "rotate-180")} />
          </button>
          {last?.chatId && (
            <button
              onClick={() => onOpenChat(last.chatId!)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-2 hover:bg-hover cursor-pointer"
              title="Read what the last run did"
            >
              <MessageSquare className="h-3 w-3" />
              Last run
            </button>
          )}
          {/* Edit, delete and run-now live in the scheduled agents view, which
              lists only your own jobs; someone else's job has no way in. */}
          {job.canManage && (
            <button
              onClick={() => onManage(job)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-2 hover:bg-hover cursor-pointer"
            >
              <Settings2 className="h-3 w-3" />
              {job.health.state === "awaiting_approval" ? "Review" : "Manage"}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function JobsSection({
  jobs,
  onOpenChat,
  onManage,
}: {
  jobs: HomeJob[]
  onOpenChat: (chatId: string) => void
  onManage: (job: HomeJob) => void
}) {
  const active = jobs.filter((j) => j.health.state !== "awaiting_approval")
  const pending = jobs.filter((j) => j.health.state === "awaiting_approval")

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">
        <CalendarClock className="h-3 w-3" />
        What runs on its own
      </h2>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">
          Nothing runs on a schedule yet. Ask the agent to set something up — it will wait for
          approval before it runs.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hairline">
          {active.map((job) => (
            <JobCard key={job.id} job={job} onOpenChat={onOpenChat} onManage={onManage} />
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <>
          <h3 className="mt-4 text-[11px] uppercase tracking-wide text-ink-3">Awaiting approval</h3>
          <p className="mt-1 text-[12px] text-ink-3">
            Proposed by an agent; nothing runs until the person named approves it.
          </p>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-dashed border-line-strong bg-surface">
            {pending.map((job) => (
              <JobCard key={job.id} job={job} onOpenChat={onOpenChat} onManage={onManage} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
