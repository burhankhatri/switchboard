import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ db: { homeOperation: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, workspace: { findFirst: vi.fn() }, workspaceWidget: { findFirst: vi.fn() }, homeInsight: { upsert: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() }, create: vi.fn(), update: vi.fn(), generate: vi.fn(), cleanup: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.db }))
vi.mock("./widget-store", () => ({ createWidget: mocks.create, updateWidget: mocks.update }))
vi.mock("./ai-model", () => ({ generateHomePlan: mocks.generate, homeAiEnabled: () => true, cleanupHomeRuntime: mocks.cleanup }))
vi.mock("./ai-context", () => ({ homeContext: vi.fn() }))
import { runHomeOperation, oneChangePlan } from "./ai-worker"

const change = (key: string) => ({ targetId: null, version: null, key, type: "note" as const, title: key, content: { markdown: "Evidence" }, reason: "Relevant", evidence: [] })
let op: Record<string, any>
beforeEach(() => {
  vi.clearAllMocks()
  op = { id: "op", workspaceId: "ws", userId: "member", kind: "accept", status: "queued", cursor: 0, events: [], receipts: [], sequence: 0, generationComplete: true, plan: { changes: [change("one"), change("two")], insights: [] }, leaseToken: null, leaseUntil: null }
  mocks.db.$transaction.mockImplementation(async fn => {
    const before = structuredClone(op)
    try { return await fn(mocks.db) } catch (e) { op = before; throw e }
  })
  mocks.db.homeOperation.findUniqueOrThrow.mockImplementation(async () => structuredClone(op))
  mocks.db.homeOperation.findUnique.mockImplementation(async () => structuredClone(op))
  const update = async ({ where, data }: any) => {
    if (where.leaseToken && where.leaseToken !== op.leaseToken) return { count: 0 }
    if (typeof where.status === "string" && where.status !== op.status) return { count: 0 }
    if (where.status?.in && !where.status.in.includes(op.status)) return { count: 0 }
    Object.assign(op, data)
    return { count: 1 }
  }
  mocks.db.homeOperation.updateMany.mockImplementation(update)
  mocks.db.homeOperation.update.mockImplementation(update)
  mocks.db.workspace.findFirst.mockResolvedValue({ id: "ws", path: "workspaces/team" })
  mocks.create.mockImplementation(async (_ws, c) => ({ ok: true, value: { id: c.key } }))
  mocks.update.mockResolvedValue({ ok: true, value: { id: "target" } })
})

describe("durable home writes", () => {
  it("saves each validated component with its receipt and completes", async () => {
    await runHomeOperation("op")
    expect(op.status).toBe("completed")
    expect(op.cursor).toBe(2)
    expect(op.receipts).toEqual([{ id: "one", title: "one" }, { id: "two", title: "two" }])
  })
  it("resumes after committed writes without repeating them", async () => {
    op.cursor = 1; op.receipts = [{ id: "one", title: "one" }]
    await runHomeOperation("op")
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][1].key).toBe("two")
  })
  it("retains successful writes when a later change fails", async () => {
    mocks.create.mockResolvedValueOnce({ ok: true, value: { id: "one" } }).mockResolvedValueOnce({ ok: false, error: "Widget capacity reached" })
    await runHomeOperation("op")
    expect(op.status).toBe("partial")
    expect(op.cursor).toBe(1)
    expect(op.error).toMatch(/capacity/)
  })
  it("rejects a revoked member before generating or writing", async () => {
    mocks.db.workspace.findFirst.mockResolvedValue(null)
    await runHomeOperation("op")
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(op.status).toBe("failed")
  })
  it("checks membership again for each write", async () => {
    mocks.db.workspace.findFirst.mockResolvedValueOnce({ id: "ws", path: "workspaces/team" }).mockResolvedValue(null)
    await runHomeOperation("op")
    expect(mocks.create).not.toHaveBeenCalled()
    expect(op.status).toBe("failed")
  })
  it("does not overwrite a component changed after its preview", async () => {
    op.plan.changes = [{ ...change("one"), targetId: "target", version: "2026-01-01T00:00:00.000Z" }]
    mocks.db.workspaceWidget.findFirst.mockResolvedValue({ id: "target", updatedAt: new Date("2026-02-01") })
    await runHomeOperation("op")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(op.error).toMatch(/changed since/)
  })
  it("does not execute cancelled work", async () => {
    op.status = "cancelled"
    await runHomeOperation("op")
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("previews suggestions without writing widgets", async () => {
    op.kind = "suggestions"
    await runHomeOperation("op")
    expect(op.status).toBe("completed")
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("skips a component the store refuses in a generated run and saves the rest", async () => {
    op.kind = "create"
    mocks.create.mockResolvedValueOnce({ ok: false, error: "No such file" }).mockResolvedValueOnce({ ok: true, value: { id: "two" } })
    await runHomeOperation("op")
    expect(op.status).toBe("completed")
    expect(op.receipts).toEqual([{ id: "two", title: "two" }])
  })
  it("fails with the reason, and regenerates on retry, when every component is refused", async () => {
    op.kind = "create"
    mocks.create.mockResolvedValue({ ok: false, error: "No such file" })
    await runHomeOperation("op")
    expect(op.status).toBe("failed")
    expect(op.error).toMatch(/No such file/)
    expect(op).toMatchObject({ cursor: 0, generationComplete: false, plan: { changes: [], insights: [] } })
  })
  it("shows supported suggestions and leaves out the unsupported one", async () => {
    const source = { chatId: "c", messageId: "m", author: "A", date: "d" }
    Object.assign(op, { kind: "suggestions", generationComplete: false, plan: null, context: { sources: [source], widgets: [], insights: [] } })
    mocks.generate.mockResolvedValue({ plan: { changes: [change("one"), { ...change("two"), evidence: [source] }], insights: [] }, complete: true })
    await runHomeOperation("op")
    expect(op.status).toBe("completed")
    expect(op.plan.changes.map((c: { key: string }) => c.key)).toEqual(["two"])
  })
  it("accepts just the selected suggestion", () => {
    expect(oneChangePlan(op.plan, 1).changes.map(c => c.key)).toEqual(["two"])
    expect(() => oneChangePlan(op.plan, 5)).toThrow(/no longer exists/)
  })
})
