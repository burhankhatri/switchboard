import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/**
 * The one place workspace events are written.
 *
 * An event is a line in a workspace's shared activity feed. Recording one is
 * always secondary to the action that caused it — a job being created, a run
 * finishing — so this never throws and callers do not await it.
 */

export type WorkspaceEventKind =
  | "job_created"
  | "job_approved"
  | "job_enabled"
  | "job_disabled"
  | "job_deleted"
  | "run_completed"
  | "run_failed"
  | "files_committed"
  | "widget_created"
  | "widget_updated"
  | "widget_removed"
  | "member_joined"
  | "member_left"
  | "chat_shared"

export interface WorkspaceEventInput {
  /**
   * Accepts null so call sites holding a job or chat that may predate
   * workspaces can pass `job.workspaceId` straight through.
   */
  workspaceId: string | null | undefined
  kind: WorkspaceEventKind
  /** Frozen display line, e.g. "Weekly Lead Run failed: HubSpot 401". */
  summary: string
  actorUserId?: string | null
  jobId?: string | null
  runId?: string | null
  chatId?: string | null
  widgetId?: string | null
  meta?: Record<string, unknown>
}

/** Error text quoted into a summary can be a whole provider JSON body. */
export const SUMMARY_MAX = 280

export function clampSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat
}

export async function recordWorkspaceEvent(input: WorkspaceEventInput): Promise<void> {
  if (!input.workspaceId) return
  try {
    await prisma.workspaceEvent.create({
      data: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        summary: clampSummary(input.summary),
        actorUserId: input.actorUserId ?? null,
        jobId: input.jobId ?? null,
        runId: input.runId ?? null,
        chatId: input.chatId ?? null,
        widgetId: input.widgetId ?? null,
        meta: input.meta ? (input.meta as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (err) {
    console.error("[workspace-events] failed to record", input.kind, err)
  }
}

export function recordWorkspaceEventAsync(input: WorkspaceEventInput): void {
  void recordWorkspaceEvent(input)
}
