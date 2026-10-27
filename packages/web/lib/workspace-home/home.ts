import { prisma } from "@/lib/db/prisma"
import { workspaceVisibleChatIds } from "./chat-visibility"
import { EVENT_SELECT, listWorkspaceEvents, toFeedEvents, type FeedEvent } from "./feed"
import { jobHealth, scheduleInWords, type JobHealth } from "./jobs"
import {
  countSince,
  isEmpty,
  pickHighlights,
  shouldTouchLastSeen,
  sinceFor,
  type SinceCounts,
} from "./since"
import { WIDGET_SELECT, toWidgetDto, type WidgetDto } from "./widget-dto"

export interface HomeJob {
  id: string
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  health: JobHealth
  author: { id: string; name: string | null; image: string | null }
  /** Edit, delete and run-now stay with the author; others only look. */
  canManage: boolean
  lastRun: {
    id: string
    status: string
    startedAt: string
    completedAt: string | null
    error: string | null
    chatId: string | null
  } | null
}

export interface SharedChat {
  id: string
  title: string
  owner: { id: string; name: string | null; image: string | null }
  sharedAt: string
  isYours: boolean
}

export interface WorkspaceHome {
  jobs: HomeJob[]
  widgets: WidgetDto[]
  feed: { events: FeedEvent[]; nextCursor: string | null }
  sharedChats: SharedChat[]
  since: { from: string; firstVisit: boolean; counts: SinceCounts; highlights: FeedEvent[] } | null
}

/** Enough to count a busy week without reading a busy year. */
const SINCE_EVENT_LIMIT = 500

/**
 * Everything the home page shows, for a caller whose membership has already
 * been checked. Reads first, then moves lastSeenAt, so the summary returned is
 * the one for the visit that is starting rather than an empty one.
 */
export async function loadWorkspaceHome(
  workspaceId: string,
  userId: string,
  now = new Date()
): Promise<WorkspaceHome> {
  const [membership, jobs, widgetRows, feed, sharedChatRows] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { lastSeenAt: true },
    }),
    prisma.scheduledJob.findMany({
      where: { workspaceId, isDraft: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        prompt: true,
        userId: true,
        enabled: true,
        approvedAt: true,
        triggerType: true,
        intervalMinutes: true,
        consecutiveFailures: true,
        user: { select: { id: true, name: true, image: true } },
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            error: true,
            chatId: true,
          },
        },
      },
    }),
    prisma.workspaceWidget.findMany({
      where: { workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: WIDGET_SELECT,
    }),
    listWorkspaceEvents(workspaceId),
    prisma.chat.findMany({
      where: { workspaceId, sharedToWorkspaceAt: { not: null } },
      orderBy: { sharedToWorkspaceAt: "desc" },
      take: 10,
      select: {
        id: true,
        displayName: true,
        sharedToWorkspaceAt: true,
        user: { select: { id: true, name: true, image: true } },
      },
    }),
  ])

  const lastSeenAt = membership?.lastSeenAt ?? null
  const since = sinceFor(lastSeenAt, now)

  const [sinceRows, visibleWidgetChats] = await Promise.all([
    prisma.workspaceEvent.findMany({
      where: { workspaceId, createdAt: { gt: since } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SINCE_EVENT_LIMIT,
      select: EVENT_SELECT,
    }),
    workspaceVisibleChatIds(
      workspaceId,
      widgetRows.map((w) => w.sourceChatId)
    ),
  ])

  if (shouldTouchLastSeen(lastSeenAt, now)) {
    void prisma.workspaceMember
      .update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { lastSeenAt: now },
      })
      .catch((err) => console.error("[workspace-home] could not record visit", err))
  }

  const jobRefs = new Map(jobs.map((j) => [j.id, j]))
  const widgets = widgetRows.map((row) =>
    toWidgetDto(row, { jobs: jobRefs, visibleChats: visibleWidgetChats, now })
  )

  const counts = countSince(
    sinceRows,
    widgetRows.filter((w) => w.updatedAt > since).length
  )
  const highlights = isEmpty(counts)
    ? []
    : await toFeedEvents(workspaceId, pickHighlights(sinceRows))

  return {
    jobs: jobs.map((j) => {
      const last = j.runs[0] ?? null
      return {
        id: j.id,
        name: j.name,
        prompt: j.prompt,
        schedule: scheduleInWords(j),
        enabled: j.enabled,
        health: jobHealth({
          enabled: j.enabled,
          approvedAt: j.approvedAt,
          consecutiveFailures: j.consecutiveFailures,
          lastRunStatus: last?.status ?? null,
        }),
        author: j.user,
        canManage: j.userId === userId,
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              startedAt: last.startedAt.toISOString(),
              completedAt: last.completedAt?.toISOString() ?? null,
              error: last.error,
              chatId: last.chatId,
            }
          : null,
      }
    }),
    widgets,
    feed,
    sharedChats: sharedChatRows.map((c) => ({
      id: c.id,
      title: c.displayName || "Untitled chat",
      owner: c.user,
      sharedAt: c.sharedToWorkspaceAt!.toISOString(),
      isYours: c.user.id === userId,
    })),
    since: isEmpty(counts)
      ? null
      : { from: since.toISOString(), firstVisit: !lastSeenAt, counts, highlights },
  }
}
