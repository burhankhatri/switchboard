import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  chatWithAuth: vi.fn(),
  member: vi.fn(),
  update: vi.fn(),
  record: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: m.auth,
  isAuthError: (value: unknown) => value instanceof Response,
  getChatWithAuth: m.chatWithAuth,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  internalError: () => Response.json({ error: "failed" }, { status: 500 }),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspaceMember: { findUnique: m.member }, chat: { update: m.update } },
}))
vi.mock("@/lib/workspace-home/events", () => ({ recordWorkspaceEventAsync: m.record }))
import { POST, DELETE } from "./route"

const ctx = { params: Promise.resolve({ chatId: "c1" }) }
const req = {} as NextRequest
const chat = (over: Record<string, unknown> = {}) => ({
  id: "c1", userId: "owner", workspaceId: "ws", displayName: "Lead research",
  sharedToWorkspaceAt: null, ...over,
})

describe("workspace-share", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.auth.mockResolvedValue({ userId: "owner" })
    m.chatWithAuth.mockResolvedValue(chat())
    m.member.mockResolvedValue({ role: "member" })
    m.update.mockResolvedValue({})
  })

  it("is refused to anyone but the owner", async () => {
    // getChatWithAuth returns null for a chat the caller does not own.
    m.chatWithAuth.mockResolvedValue(null)
    expect((await POST(req, ctx)).status).toBe(404)
    expect((await DELETE(req, ctx)).status).toBe(404)
    expect(m.update).not.toHaveBeenCalled()
  })

  it("cannot share a chat that has no workspace", async () => {
    m.chatWithAuth.mockResolvedValue(chat({ workspaceId: null }))
    expect((await POST(req, ctx)).status).toBe(400)
  })

  it("cannot share into a workspace the owner has left", async () => {
    m.member.mockResolvedValue(null)
    expect((await POST(req, ctx)).status).toBe(403)
    expect(m.update).not.toHaveBeenCalled()
  })

  it("shares, and records it in the feed", async () => {
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data.sharedToWorkspaceAt).toBeInstanceOf(Date)
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws", kind: "chat_shared", chatId: "c1" })
    )
  })

  it("does not record a second share of an already shared chat", async () => {
    m.chatWithAuth.mockResolvedValue(chat({ sharedToWorkspaceAt: new Date() }))
    await POST(req, ctx)
    expect(m.update).not.toHaveBeenCalled()
    expect(m.record).not.toHaveBeenCalled()
  })

  it("unshares", async () => {
    m.chatWithAuth.mockResolvedValue(chat({ sharedToWorkspaceAt: new Date() }))
    const body = await (await DELETE(req, ctx)).json()
    expect(m.update.mock.calls[0][0].data).toEqual({ sharedToWorkspaceAt: null })
    expect(body.sharedToWorkspaceAt).toBeNull()
  })
})
