import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  workspace: vi.fn(),
  events: vi.fn(),
  chats: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: mocks.auth,
  isAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  internalError: () => Response.json({ error: "failed" }, { status: 500 }),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: { findFirst: mocks.workspace },
    workspaceEvent: { findMany: mocks.events },
    chat: { findMany: mocks.chats },
  },
}))
import { GET } from "./route"

function get(before?: string) {
  const url = new URL("http://localhost/api/workspaces/ws/events")
  if (before) url.searchParams.set("before", before)
  const req = Object.assign(new Request(url), { nextUrl: url }) as unknown as NextRequest
  return GET(req, { params: Promise.resolve({ id: "ws" }) })
}

const event = (id: string, chatId: string | null = null) => ({
  id,
  kind: "files_committed",
  summary: "Agent committed 2 changes to main",
  createdAt: new Date("2026-10-20T10:00:00Z"),
  jobId: null,
  runId: null,
  chatId,
  widgetId: null,
  meta: null,
  actor: { id: "u1", name: "Ana", image: null },
})

describe("GET /api/workspaces/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ userId: "member" })
    mocks.workspace.mockResolvedValue({
      id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members: [{ role: "member" }],
    })
    mocks.chats.mockResolvedValue([])
  })

  it("rejects a non-member before reading any event", async () => {
    mocks.workspace.mockResolvedValue({
      id: "ws", slug: "ws", name: "WS", path: "workspaces/ws", members: [],
    })
    const res = await get()
    expect(res.status).toBe(403)
    expect(mocks.events).not.toHaveBeenCalled()
  })

  it("links only chats that every member can open", async () => {
    mocks.events.mockResolvedValue([event("e1", "private-chat"), event("e2", "shared-chat")])
    mocks.chats.mockResolvedValue([{ id: "shared-chat" }])
    const body = await (await get()).json()

    expect(body.events.map((e: { chatId: string | null }) => e.chatId)).toEqual([
      null,
      "shared-chat",
    ])
    // The visibility query is scoped to this workspace, so a chat shared to a
    // different workspace never becomes linkable here.
    expect(mocks.chats.mock.calls[0][0].where.workspaceId).toBe("ws")
  })

  it("pages from the cursor and reports whether more exist", async () => {
    mocks.events.mockResolvedValue(Array.from({ length: 31 }, (_, i) => event(`e${i}`)))
    const body = await (await get("e-prev")).json()

    const args = mocks.events.mock.calls[0][0]
    expect(args.cursor).toEqual({ id: "e-prev" })
    expect(args.skip).toBe(1)
    expect(body.events).toHaveLength(30)
    expect(body.nextCursor).toBe("e29")
  })

  it("has no next page at the end of the feed", async () => {
    mocks.events.mockResolvedValue([event("e1")])
    const body = await (await get()).json()
    expect(body.nextCursor).toBeNull()
  })
})
