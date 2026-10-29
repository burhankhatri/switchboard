import { beforeEach, describe, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ auth: vi.fn(), gate: vi.fn(), after: vi.fn(), run: vi.fn(),
  db: { workspaceWidget: { findFirst: vi.fn() }, homeOperation: { count: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() },
}))
vi.mock("next/server", () => ({ after: m.after }))
vi.mock("@/lib/db/prisma", () => ({ prisma: m.db }))
vi.mock("@/lib/db/api-helpers", () => ({ requireAuth: m.auth, isAuthError: (r: unknown) => r instanceof Response, badRequest: (error: string) => Response.json({ error }, { status: 400 }), internalError: () => new Response(null, { status: 500 }) }))
vi.mock("@/lib/workspace-gate", () => ({ gateWorkspace: m.gate }))
vi.mock("@/lib/workspace-home/ai-model", () => ({ homeAiEnabled: () => true, cleanupHomeRuntime: vi.fn() }))
vi.mock("@/lib/workspace-home/ai-view", () => ({ homeAiView: vi.fn() }))
vi.mock("@/lib/workspace-home/ai-worker", () => ({ runHomeOperation: m.run, enqueueHomeInsights: vi.fn(), oneChangePlan: (plan: { changes: unknown[] }, index: number) => ({ changes: [plan.changes[index]], insights: [] }) }))
import { POST } from "./route"
const send = (body: unknown) => POST(new Request("http://localhost/api/workspaces/ws/home/ai", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "ws" }) })
beforeEach(() => {
  vi.clearAllMocks(); m.auth.mockResolvedValue({ userId: "u" }); m.gate.mockResolvedValue({ ok: true, workspace: { id: "ws" } })
  m.db.homeOperation.count.mockResolvedValue(0); m.db.homeOperation.upsert.mockResolvedValue({ id: "op" })
  m.db.$transaction.mockImplementation(fn => fn(m.db))
})
describe("home operation API", () => {
  it("requires authentication and workspace membership", async () => {
    m.auth.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await send({})).status).toBe(401)
    m.auth.mockResolvedValue({ userId: "u" }); m.gate.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await send({})).status).toBe(403)
    expect(m.db.homeOperation.upsert).not.toHaveBeenCalled()
  })
  it("scopes a targeted edit to this workspace", async () => {
    m.db.workspaceWidget.findFirst.mockResolvedValue(null)
    expect((await send({ action: "start", kind: "edit", prompt: "Edit", targetId: "other", targetVersion: "2026-10-28T00:00:00.000Z", requestKey: "req" })).status).toBe(400)
    expect(m.db.workspaceWidget.findFirst).toHaveBeenCalledWith({ where: { id: "other", workspaceId: "ws" } })
  })
  it("uses a stable member-scoped idempotency key on repeated sends", async () => {
    const body = { action: "start", kind: "create", prompt: "Summary", requestKey: "same" }
    await send(body); await send(body)
    for (const [input] of m.db.homeOperation.upsert.mock.calls) expect(input.where.workspaceId_requestKey).toEqual({ workspaceId: "ws", requestKey: "u:same" })
  })
  it("acceptance by different members resolves to one operation", async () => {
    const change = { targetId: null, version: null, key: "summary", type: "summary", title: "Overview", content: { headline: "Current work" }, reason: "Team discussion", evidence: [] }
    m.db.homeOperation.findFirst.mockResolvedValue({ id: "suggest", kind: "suggestions", status: "completed", dismissed: [], plan: { changes: [change], insights: [] } })
    await send({ action: "accept", operationId: "suggest", index: 0 })
    m.auth.mockResolvedValue({ userId: "colleague" })
    await send({ action: "accept", operationId: "suggest", index: 0 })
    for (const [input] of m.db.homeOperation.upsert.mock.calls) expect(input.where.workspaceId_requestKey.requestKey).toBe("accept:suggest:0")
  })
  it("does not let another member cancel a person's operation", async () => {
    m.db.homeOperation.findFirst.mockResolvedValue({ id: "op", userId: "someone-else" })
    expect((await send({ action: "cancel", operationId: "op" })).status).toBe(400)
    expect(m.db.homeOperation.updateMany).not.toHaveBeenCalled()
  })
})
