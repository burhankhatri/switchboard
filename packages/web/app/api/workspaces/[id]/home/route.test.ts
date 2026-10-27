import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  workspace: vi.fn(),
  member: vi.fn(),
  memberUpdate: vi.fn(),
  jobs: vi.fn(),
  widgets: vi.fn(),
  events: vi.fn(),
  chats: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: m.auth,
  isAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  internalError: (e: unknown) => {
    console.error(e)
    return Response.json({ error: "failed" }, { status: 500 })
  },
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: { findFirst: m.workspace },
    workspaceMember: { findUnique: m.member, update: m.memberUpdate },
    scheduledJob: { findMany: m.jobs },
    workspaceWidget: { findMany: m.widgets },
    workspaceEvent: { findMany: m.events },
    chat: { findMany: m.chats },
  },
}))
import { GET } from "./route"

const get = () =>
  GET({} as NextRequest, { params: Promise.resolve({ id: "ws" }) })

const job = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  name: "Weekly Leads",
  prompt: "Find 50 installers",
  userId: "builder",
  enabled: true,
  approvedAt: new Date(),
  triggerType: "interval",
  intervalMinutes: 10080,
  consecutiveFailures: 0,
  user: { id: "builder", name: "Bea", image: null },
  runs: [
    {
      id: "r1",
      status: "completed",
      startedAt: new Date("2026-10-25T09:00:00Z"),
      completedAt: new Date("2026-10-25T09:10:00Z"),
      error: null,
      chatId: "run-chat",
    },
  ],
  ...over,
})

const event = (id: string, kind: string, jobId: string | null = null) => ({
  id,
  kind,
  summary: kind,
  createdAt: new Date("2026-10-25T10:00:00Z"),
  jobId,
  runId: null,
  chatId: null,
  widgetId: null,
  meta: null,
  actor: null,
})

describe("GET /api/workspaces/:id/home", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.auth.mockResolvedValue({ userId: "reader" })
    m.workspace.mockResolvedValue({
      id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members: [{ role: "member" }],
    })
    m.member.mockResolvedValue({ lastSeenAt: null })
    m.memberUpdate.mockResolvedValue({})
    m.jobs.mockResolvedValue([job()])
    m.widgets.mockResolvedValue([])
    m.events.mockResolvedValue([])
    m.chats.mockResolvedValue([])
  })

  it("refuses a non-member before reading anything", async () => {
    m.workspace.mockResolvedValue({
      id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members: [],
    })
    expect((await get()).status).toBe(403)
    expect(m.jobs).not.toHaveBeenCalled()
  })

  it("shows a job someone else set up, without its controls", async () => {
    const body = await (await get()).json()
    expect(m.jobs.mock.calls[0][0].where).toEqual({ workspaceId: "ws", isDraft: false })
    expect(body.jobs[0]).toMatchObject({
      name: "Weekly Leads",
      schedule: "Every week",
      canManage: false,
      author: { name: "Bea" },
      health: { state: "healthy" },
      lastRun: { chatId: "run-chat" },
    })
  })

  it("lets the author manage their own job", async () => {
    m.auth.mockResolvedValue({ userId: "builder" })
    const body = await (await get()).json()
    expect(body.jobs[0].canManage).toBe(true)
  })

  it("summarises what happened since the last visit, failures first", async () => {
    m.member.mockResolvedValue({ lastSeenAt: new Date("2026-10-20T00:00:00Z") })
    // listWorkspaceEvents runs first, then the since query.
    m.events
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        event("e1", "run_completed", "j1"),
        event("e2", "run_failed", "j2"),
      ])
    const body = await (await get()).json()

    expect(body.since.counts).toMatchObject({ runs: 2, failingJobs: 1 })
    expect(body.since.highlights.map((h: { id: string }) => h.id)).toEqual(["e2", "e1"])
    expect(body.since.firstVisit).toBe(false)
  })

  it("has no summary when nothing happened", async () => {
    const body = await (await get()).json()
    expect(body.since).toBeNull()
  })

  it("records the visit, but not again on a quick refetch", async () => {
    await get()
    expect(m.memberUpdate).toHaveBeenCalledTimes(1)

    m.memberUpdate.mockClear()
    m.member.mockResolvedValue({ lastSeenAt: new Date(Date.now() - 30_000) })
    await get()
    expect(m.memberUpdate).not.toHaveBeenCalled()
  })

  it("marks a job-fed widget stale after two missed runs", async () => {
    m.jobs.mockResolvedValue([job({ intervalMinutes: 60 })])
    m.widgets.mockResolvedValue([
      {
        id: "w1", key: "leads", type: "stat", title: "Leads", content: { value: "42" },
        position: 0, createdVia: "agent", updatedAt: new Date(Date.now() - 3 * 60 * 60_000),
        sourceChatId: null, sourceMessageId: null, sourceJobId: "j1", sourceRunId: "r1",
        createdBy: { id: "builder", name: "Bea" }, updatedBy: { id: "builder", name: "Bea" },
      },
    ])
    const body = await (await get()).json()
    expect(body.widgets[0]).toMatchObject({
      stale: true,
      source: { job: { id: "j1", name: "Weekly Leads", runId: "r1" }, chatId: null },
    })
  })
})
