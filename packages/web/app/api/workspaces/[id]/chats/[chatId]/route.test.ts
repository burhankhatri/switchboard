import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  workspace: vi.fn(),
  chat: vi.fn(),
  messages: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: m.auth,
  isAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  internalError: () => Response.json({ error: "failed" }, { status: 500 }),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: { findFirst: m.workspace },
    chat: { findFirst: m.chat },
    message: { findMany: m.messages },
  },
}))
import { GET } from "./route"

const get = () =>
  GET({} as NextRequest, { params: Promise.resolve({ id: "ws", chatId: "c1" }) })

const member = (members: { role: string }[]) => ({
  id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members,
})

describe("GET /api/workspaces/:id/chats/:chatId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.auth.mockResolvedValue({ userId: "reader" })
    m.workspace.mockResolvedValue(member([{ role: "member" }]))
    m.messages.mockResolvedValue([])
  })

  it("refuses someone who is not (or no longer) a member", async () => {
    m.workspace.mockResolvedValue(member([]))
    expect((await get()).status).toBe(403)
    expect(m.chat).not.toHaveBeenCalled()
  })

  it("only finds chats shared to, or run by, this workspace", async () => {
    m.chat.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    const where = m.chat.mock.calls[0][0].where
    expect(where).toMatchObject({ id: "c1", workspaceId: "ws" })
    expect(where.OR).toEqual([
      { sharedToWorkspaceAt: { not: null } },
      { scheduledJobRun: { isNot: null } },
    ])
  })

  it("returns the sanitized transcript with who it belongs to", async () => {
    m.chat.mockResolvedValue({
      id: "c1", displayName: "Lead research", repo: "org/ws", parentChatId: null,
      sharedToWorkspaceAt: new Date("2026-10-25T00:00:00Z"),
      user: { id: "builder", name: "Bea", image: null },
      scheduledJobRun: null,
    })
    m.messages.mockResolvedValue([
      {
        id: "m1", role: "assistant", content: "Found 12", timestamp: BigInt(1), messageType: null,
        isError: false, toolCalls: [{ tool: "Read", filePath: "/home/sandbox/secret" }],
        contentBlocks: null, uploadedFiles: null, linkBranch: null, metadata: null, agent: null, model: null,
      },
    ])
    const body = await (await get()).json()
    expect(body).toMatchObject({ displayName: "Lead research", owner: { name: "Bea" }, isYours: false, run: null })
    // Same stripping as a public link: no sandbox paths.
    expect(body.messages[0].toolCalls[0]).not.toHaveProperty("filePath")
  })
})
