import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { workspaceVisibleChatIds } from "./chat-visibility"
import type { WorkspaceEventKind } from "./events"

export const FEED_PAGE_SIZE = 30

export interface FeedEvent {
  id: string
  kind: WorkspaceEventKind
  summary: string
  createdAt: string
  actor: { id: string; name: string | null; image: string | null } | null
  jobId: string | null
  runId: string | null
  /** Only set when every member can open the chat; see workspaceVisibleChatIds. */
  chatId: string | null
  widgetId: string | null
  meta: Record<string, unknown> | null
}

/**
 * One page of a workspace's feed, newest first. `before` is the id of the last
 * event already shown.
 *
 * Callers must have checked membership; this only reads.
 */
export async function listWorkspaceEvents(
  workspaceId: string,
  opts: { before?: string | null; take?: number } = {}
): Promise<{ events: FeedEvent[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? FEED_PAGE_SIZE, 1), 100)
  const rows = await prisma.workspaceEvent.findMany({
    where: { workspaceId },
    // id breaks ties so two events in the same millisecond page stably.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: EVENT_SELECT,
  })

  const page = rows.slice(0, take)
  return {
    events: await toFeedEvents(workspaceId, page),
    nextCursor: rows.length > take ? page[page.length - 1].id : null,
  }
}

export const EVENT_SELECT = {
  id: true,
  kind: true,
  summary: true,
  createdAt: true,
  jobId: true,
  runId: true,
  chatId: true,
  widgetId: true,
  meta: true,
  actor: { select: { id: true, name: true, image: true } },
} as const

type EventRow = Prisma.WorkspaceEventGetPayload<{ select: typeof EVENT_SELECT }>

/** Rows to feed entries, dropping links to chats members cannot open. */
export async function toFeedEvents(workspaceId: string, rows: EventRow[]): Promise<FeedEvent[]> {
  const visible = await workspaceVisibleChatIds(
    workspaceId,
    rows.map((e) => e.chatId)
  )
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind as WorkspaceEventKind,
    summary: e.summary,
    createdAt: e.createdAt.toISOString(),
    actor: e.actor,
    jobId: e.jobId,
    runId: e.runId,
    chatId: e.chatId && visible.has(e.chatId) ? e.chatId : null,
    widgetId: e.widgetId,
    meta: (e.meta as Record<string, unknown> | null) ?? null,
  }))
}
