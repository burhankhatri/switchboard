import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  workspace: vi.fn(),
  count: vi.fn(),
  widgetFindFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  event: vi.fn(),
  approvalCount: vi.fn(),
  approvalCreate: vi.fn(),
  chatUpdate: vi.fn(),
  notify: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: { findFirst: m.workspace },
    workspaceWidget: { count: m.count, findFirst: m.widgetFindFirst, create: m.create, update: m.update },
    workspaceEvent: { create: m.event },
    chatApproval: { count: m.approvalCount, create: m.approvalCreate },
    chat: { update: m.chatUpdate },
  },
}))
vi.mock("@/lib/db/notifications", () => ({ notifyAsync: m.notify }))
import { POST } from "./route"
import { mintRunToken } from "@/lib/mcp/run-token"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-run-tokens"
})

const interactive = { userId: "u1", workspaceId: "ws", chatId: "c1" }
const scheduled = { userId: "author", workspaceId: "ws", chatId: "run-chat", jobId: "j1", jobRunId: "r1" }

function call(claims: object, method: string, params?: object) {
  const token = mintRunToken(claims as Parameters<typeof mintRunToken>[0])
  const req = new Request("http://localhost/api/mcp/scheduler", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return POST(req as unknown as NextRequest).then((r) => r.json())
}

const member = { id: "ws", path: "workspaces/ws", members: [{ role: "member" }] }

beforeEach(() => {
  vi.clearAllMocks()
  m.workspace.mockResolvedValue(member)
  m.count.mockResolvedValue(0)
  m.widgetFindFirst.mockResolvedValue(null)
  m.create.mockResolvedValue({ id: "w1", key: "weekly-leads" })
  m.update.mockResolvedValue({})
  m.event.mockResolvedValue({})
  m.approvalCount.mockResolvedValue(0)
  m.approvalCreate.mockResolvedValue({ id: "apr_1" })
  m.chatUpdate.mockResolvedValue({})
})

describe("request_approval", () => {
  // The write gate: the agent asks, a person clicks, the next turn carries
  // SWITCHBOARD_APPROVAL. Nothing here grants anything by itself.
  it("records a pending approval, parks the chat as awaiting input and tells the agent to stop", async () => {
    const res = await call(interactive, "tools/call", {
      name: "request_approval",
      arguments: { action: "add leads to campaign", count: 16, campaign: "DFW industrial (7c08d5fb)" },
    })
    expect(res.result.isError).toBe(false)
    expect(res.result.content[0].text).toMatch(/stop|end this turn/i)
    expect(res.result.content[0].text).toMatch(/SWITCHBOARD_APPROVAL/)
    expect(m.approvalCreate.mock.calls[0][0].data).toMatchObject({
      chatId: "c1",
      userId: "u1",
      action: "add leads to campaign",
      count: 16,
      campaign: "DFW industrial (7c08d5fb)",
      status: "pending",
    })
    expect(m.chatUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "c1" }, data: { awaitingInput: true } })
    expect(m.notify).toHaveBeenCalledTimes(1)
    expect(m.notify.mock.calls[0][0]).toMatchObject({ userId: "u1", kind: "approval_requested", chatId: "c1" })
  })

  it("needs an action", async () => {
    const res = await call(interactive, "tools/call", { name: "request_approval", arguments: { count: 3 } })
    expect(res.result.isError).toBe(true)
    expect(m.approvalCreate).not.toHaveBeenCalled()
  })

  it("refuses to pile up requests", async () => {
    m.approvalCount.mockResolvedValue(3)
    const res = await call(interactive, "tools/call", { name: "request_approval", arguments: { action: "x" } })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/already waiting/i)
  })

  it("is not offered to a scheduled run, which has nobody to click", async () => {
    const list = await call(scheduled, "tools/list")
    expect(list.result.tools.map((t: { name: string }) => t.name)).not.toContain("request_approval")
    const res = await call(scheduled, "tools/call", { name: "request_approval", arguments: { action: "x" } })
    expect(res.error.code).toBe(-32602)
  })
})

describe("tools/list", () => {
  it("offers an interactive run the scheduler and the widget tools", async () => {
    const res = await call(interactive, "tools/list")
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "create_scheduled_job",
      "request_approval",
      "pin_to_home",
      "update_home_widget",
    ])
  })

  it("offers a scheduled run only the widget tools", async () => {
    const res = await call(scheduled, "tools/list")
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "pin_to_home",
      "update_home_widget",
    ])
  })

  it("refuses a scheduled run that calls the scheduler anyway", async () => {
    const res = await call(scheduled, "tools/call", {
      name: "create_scheduled_job",
      arguments: { name: "x", prompt: "y", intervalMinutes: 60 },
    })
    expect(res.error.message).toMatch(/Unknown tool/)
  })
})

describe("pin_to_home", () => {
  it("creates the widget immediately, attributed to the chat", async () => {
    const res = await call(interactive, "tools/call", {
      name: "pin_to_home",
      arguments: { type: "stat", title: "Leads this week", key: "weekly-leads", content: { value: 342 } },
    })
    expect(res.result.isError).toBe(false)
    expect(res.result.content[0].text).toMatch(/key "weekly-leads"/)
    expect(m.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws", createdVia: "agent", createdById: "u1", sourceChatId: "c1", sourceJobId: null,
    })
  })

  it("explains a schema failure so the agent can correct itself", async () => {
    const res = await call(interactive, "tools/call", {
      name: "pin_to_home",
      arguments: { type: "table", title: "x", content: { columns: ["A", "B"], rows: [["one"]] } },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/Row 1 has 1 cells/)
    expect(m.create).not.toHaveBeenCalled()
  })

  it("re-checks membership at call time", async () => {
    m.workspace.mockResolvedValue({ ...member, members: [] })
    const res = await call(interactive, "tools/call", {
      name: "pin_to_home",
      arguments: { type: "note", title: "x", content: { markdown: "y" } },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/no longer a member/)
  })

  it("refuses a run outside any workspace", async () => {
    const res = await call({ userId: "u1", workspaceId: null, chatId: null }, "tools/call", {
      name: "pin_to_home",
      arguments: { type: "note", title: "x", content: { markdown: "y" } },
    })
    expect(res.result.isError).toBe(true)
    expect(m.create).not.toHaveBeenCalled()
  })
})

describe("update_home_widget", () => {
  it("refreshes by key from a scheduled run, naming the job as the source", async () => {
    m.widgetFindFirst.mockResolvedValue({ id: "w1", type: "stat", title: "Leads" })
    const res = await call(scheduled, "tools/call", {
      name: "update_home_widget",
      arguments: { widget: "weekly-leads", content: { value: 401 } },
    })
    expect(res.result.isError).toBe(false)
    expect(m.widgetFindFirst.mock.calls[0][0].where).toEqual({
      workspaceId: "ws",
      OR: [{ id: "weekly-leads" }, { key: "weekly-leads" }],
    })
    expect(m.update.mock.calls[0][0].data).toMatchObject({
      sourceJobId: "j1",
      sourceRunId: "r1",
      sourceChatId: "run-chat",
    })
    // A routine refresh is not news.
    await new Promise((r) => setTimeout(r, 0))
    expect(m.event).not.toHaveBeenCalled()
  })

  it("turns a widget into another type in place, given content for it", async () => {
    m.widgetFindFirst.mockResolvedValue({ id: "w1", type: "note", title: "What happened" })
    const res = await call(interactive, "tools/call", {
      name: "update_home_widget",
      arguments: {
        widget: "w1",
        type: "timeline",
        content: { events: [{ date: "25 Sep", title: "22 leads pushed" }] },
      },
    })
    expect(res.result.isError).toBe(false)
    expect(m.update.mock.calls[0][0].data).toMatchObject({ type: "timeline" })
  })

  it("refuses a type change without content to match", async () => {
    m.widgetFindFirst.mockResolvedValue({ id: "w1", type: "note", title: "What happened" })
    const res = await call(interactive, "tools/call", {
      name: "update_home_widget",
      arguments: { widget: "w1", type: "timeline" },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/needs content/)
    expect(m.update).not.toHaveBeenCalled()
  })

  it("treats a widget from another workspace as missing", async () => {
    m.widgetFindFirst.mockResolvedValue(null)
    const res = await call(interactive, "tools/call", {
      name: "update_home_widget",
      arguments: { widget: "w-elsewhere", content: { value: 1 } },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/no widget "w-elsewhere"/)
  })
})
