import type { Prisma } from "@prisma/client"

export const WIDGET_SELECT = {
  id: true,
  key: true,
  type: true,
  title: true,
  content: true,
  position: true,
  createdVia: true,
  updatedAt: true,
  sourceChatId: true,
  sourceMessageId: true,
  sourceJobId: true,
  sourceRunId: true,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} as const

export type WidgetRow = Prisma.WorkspaceWidgetGetPayload<{ select: typeof WIDGET_SELECT }>

export interface WidgetSource {
  /** Set when a scheduled run wrote the current content. */
  job: { id: string; name: string | null; runId: string | null } | null
  /** Only set when every member may open the chat. */
  chatId: string | null
}

export interface WidgetDto {
  id: string
  key: string | null
  type: string
  title: string
  content: unknown
  position: number
  createdVia: string
  createdBy: { id: string; name: string | null } | null
  updatedBy: { id: string; name: string | null } | null
  updatedAt: string
  source: WidgetSource
  stale: boolean
}

interface JobRef {
  name: string
  triggerType: string
  intervalMinutes: number
}

/**
 * A widget refreshed by a job is stale once it has missed two of that job's
 * runs — one late run is normal jitter, two means the number on the card is
 * no longer what the job would say.
 */
export function isStale(updatedAt: Date, job: JobRef | undefined, now: Date): boolean {
  if (!job || job.triggerType !== "interval" || job.intervalMinutes <= 0) return false
  return now.getTime() - updatedAt.getTime() > 2 * job.intervalMinutes * 60_000
}

export function toWidgetDto(
  row: WidgetRow,
  ctx: { jobs: Map<string, JobRef>; visibleChats: Set<string>; now: Date }
): WidgetDto {
  const job = row.sourceJobId ? ctx.jobs.get(row.sourceJobId) : undefined
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    title: row.title,
    content: row.content,
    position: row.position,
    createdVia: row.createdVia,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
    source: {
      job: row.sourceJobId
        ? { id: row.sourceJobId, name: job?.name ?? null, runId: row.sourceRunId }
        : null,
      chatId:
        row.sourceChatId && ctx.visibleChats.has(row.sourceChatId) ? row.sourceChatId : null,
    },
    stale: isStale(row.updatedAt, job, ctx.now),
  }
}
