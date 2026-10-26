import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  workspace: vi.fn(),
  count: vi.fn(),
  widgetFindFirst: vi.fn(),
  widgetFindMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  job: vi.fn(),
  chat: vi.fn(),
  message: vi.fn(),
  event: vi.fn(),
  tx: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: m.auth,
  isAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  internalError: (e: unknown) => {
    console.error(e)
    return Response.json({ error: "failed" }, { status: 500 })
  },
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: { findFirst: m.workspace },
    workspaceWidget: {
      count: m.count,
      findFirst: m.widgetFindFirst,
      findMany: m.widgetFindMany,
      create: m.create,
      update: m.update,
      delete: m.del,
    },
    scheduledJob: { findFirst: m.job },
    chat: { findFirst: m.chat },
    message: { findFirst: m.message },
    workspaceEvent: { create: m.event },
    $transaction: m.tx,
  },
}))
import { POST, PUT } from "./route"
import { PATCH, DELETE } from "./[widgetId]/route"

const flush = () => new Promise((r) => setTimeout(r, 0))
const json = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const ctx = { params: Promise.resolve({ id: "ws" }) }
const wctx = { params: Promise.resolve({ id: "ws", widgetId: "w1" }) }
const workspace = (members: { role: string }[]) => ({
  id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.auth.mockResolvedValue({ userId: "u1" })
  m.workspace.mockResolvedValue(workspace([{ role: "member" }]))
  m.count.mockResolvedValue(0)
  m.widgetFindFirst.mockResolvedValue(null)
  m.create.mockResolvedValue({ id: "w1", key: null })
  m.update.mockResolvedValue({})
  m.del.mockResolvedValue({})
  m.event.mockResolvedValue({})
  m.tx.mockResolvedValue([])
})

describe("POST /api/workspaces/:id/widgets", () => {
  it("refuses a non-member", async () => {
    m.workspace.mockResolvedValue(workspace([]))
    expect((await POST(json({}), ctx)).status).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })

  it("creates a note at the end, attributed to the member, and records it", async () => {
    m.widgetFindFirst.mockResolvedValue({ position: 4 })
    const res = await POST(json({ type: "note", title: "Status", content: { markdown: "Paused" } }), ctx)
    expect(res.status).toBe(201)
    const data = m.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      workspaceId: "ws", type: "note", position: 5, createdVia: "manual",
      createdById: "u1", updatedById: "u1", sourceJobId: null,
    })
    await flush()
    expect(m.event.mock.calls[0][0].data).toMatchObject({ kind: "widget_created", actorUserId: "u1" })
  })

  it("rejects content that does not match its type and writes nothing", async () => {
    const res = await POST(json({ type: "stat", title: "x", content: { value: 1, html: "<b>" } }), ctx)
    expect(res.status).toBe(400)
    expect(m.create).not.toHaveBeenCalled()
  })

  it("stops at the per-workspace cap", async () => {
    m.count.mockResolvedValue(40)
    const res = await POST(json({ type: "note", title: "x", content: { markdown: "y" } }), ctx)
    expect(res.status).toBe(409)
  })

  it("only pins from the caller's own chat in this workspace", async () => {
    m.chat.mockResolvedValue(null)
    const res = await POST(
      json({ type: "note", title: "x", content: { markdown: "y" }, sourceChatId: "someone-elses" }),
      ctx
    )
    expect(res.status).toBe(400)
    expect(m.chat.mock.calls[0][0].where).toEqual({ id: "someone-elses", userId: "u1", workspaceId: "ws" })
  })

  it("records a pin's source chat and message", async () => {
    m.chat.mockResolvedValue({ id: "c1" })
    m.message.mockResolvedValue({ id: "msg1" })
    await POST(
      json({ type: "note", title: "x", content: { markdown: "y" }, sourceChatId: "c1", sourceMessageId: "msg1" }),
      ctx
    )
    expect(m.create.mock.calls[0][0].data).toMatchObject({
      createdVia: "pin", sourceChatId: "c1", sourceMessageId: "msg1",
    })
  })

  it("refuses a file widget pointing outside the workspace", async () => {
    const res = await POST(json({ type: "file", title: "x", content: { path: "workspaces/other/secret.csv" } }), ctx)
    expect(res.status).toBe(400)
  })

  it("refuses a job widget for a job in another workspace", async () => {
    m.job.mockResolvedValue(null)
    const res = await POST(json({ type: "job", title: "x", content: { jobId: "j-elsewhere" } }), ctx)
    expect(res.status).toBe(400)
    expect(m.job.mock.calls[0][0].where).toMatchObject({ id: "j-elsewhere", workspaceId: "ws" })
  })
})

describe("PATCH and DELETE /api/workspaces/:id/widgets/:widgetId", () => {
  it("treats a widget from another workspace as missing", async () => {
    m.widgetFindFirst.mockResolvedValue(null)
    const res = await PATCH(json({ title: "x" }), wctx)
    expect(res.status).toBe(404)
    expect(m.widgetFindFirst.mock.calls[0][0].where).toEqual({ workspaceId: "ws", id: "w1" })
  })

  it("rewrites provenance to the member and records the edit", async () => {
    m.widgetFindFirst.mockResolvedValue({ id: "w1", type: "stat", title: "Leads" })
    const res = await PATCH(json({ content: { value: 50 } }), wctx)
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data).toMatchObject({
      content: { value: 50 },
      updatedBy: { connect: { id: "u1" } },
      sourceJobId: null,
      sourceRunId: null,
    })
    await flush()
    expect(m.event.mock.calls[0][0].data.kind).toBe("widget_updated")
  })

  it("lets any member remove a widget and says who did", async () => {
    m.widgetFindFirst.mockResolvedValue({ id: "w1", title: "Leads" })
    const res = await DELETE(json({}), wctx)
    expect(res.status).toBe(204)
    await flush()
    expect(m.event.mock.calls[0][0].data).toMatchObject({ kind: "widget_removed", actorUserId: "u1" })
  })
})

describe("PUT /api/workspaces/:id/widgets (reorder)", () => {
  it("requires every widget exactly once", async () => {
    m.widgetFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }])
    expect((await PUT(json({ ids: ["a"] }), ctx)).status).toBe(400)
    expect((await PUT(json({ ids: ["a", "a"] }), ctx)).status).toBe(400)
    expect((await PUT(json({ ids: ["a", "x"] }), ctx)).status).toBe(400)
    expect((await PUT(json({ ids: ["b", "a"] }), ctx)).status).toBe(200)
  })
})
