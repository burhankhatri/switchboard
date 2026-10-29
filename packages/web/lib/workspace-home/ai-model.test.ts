import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { HomeOperation } from "@prisma/client"
const m = vi.hoisted(() => ({
  create: vi.fn(), get: vi.fn(), start: vi.fn(), createSession: vi.fn(), getSession: vi.fn(), snapshot: vi.fn(), credentials: vi.fn(),
  delete: vi.fn(), command: vi.fn(), meter: vi.fn(),
  db: { workspace: { findFirstOrThrow: vi.fn() }, user: { findUniqueOrThrow: vi.fn() }, homeOperation: { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() } },
}))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class { create = m.create; get = m.get } }))
vi.mock("@switchboard/sdk", () => ({ createSession: m.createSession, getSession: m.getSession }))
vi.mock("@switchboard/sandbox-image", () => ({ getActiveSnapshotName: async () => "existing-snapshot" }))
vi.mock("@/lib/db/prisma", () => ({ prisma: m.db }))
vi.mock("@/app/api/chats/[chatId]/messages/_lib/resolve-credentials", () => ({ resolveSendCredentials: m.credentials }))
vi.mock("@/lib/server/custom-endpoints", () => ({ getUserEndpoints: async () => [] }))
vi.mock("@/lib/db/api-helpers", () => ({ decryptUserCredentials: () => ({}) }))
vi.mock("@/lib/server/token-metering", () => ({ meterTurnUsage: m.meter }))
vi.mock("@/lib/agent-session", () => ({ snapshotBackgroundAgent: m.snapshot }))
vi.mock("@/lib/mcp/home-tools", () => ({ PIN_TO_HOME_TOOL: { description: "Typed widget shapes" } }))
import { generateHomePlan, cleanupHomeRuntime } from "./ai-model"

const operation = (overrides = {}) => ({ id: "home-op", workspaceId: "ws", userId: "u", prompt: "Summarise", kind: "create", cursor: 0, receipts: [], runtime: null, plan: null, ...overrides }) as unknown as HomeOperation
const runtime = () => ({ sandboxId: "sandbox", backgroundSessionId: "session", usage: { provider: "opencode", pool: "shared" }, startedAt: new Date().toISOString(), startCursor: 0 })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("DAYTONA_API_KEY", "test-only"); vi.stubEnv("HOME_AI_ENABLED", "true")
  m.db.workspace.findFirstOrThrow.mockResolvedValue({ agent: "opencode", model: "opencode-go/glm-5.2" })
  m.db.user.findUniqueOrThrow.mockResolvedValue({ credentials: null })
  m.credentials.mockResolvedValue({ credentials: { OPENCODE_API_KEY: "existing-test-credential" } })
  m.db.homeOperation.updateMany.mockResolvedValue({ count: 1 }); m.db.homeOperation.findFirst.mockResolvedValue({ id: "home-op" })
  m.create.mockResolvedValue({ id: "sandbox", delete: m.delete, process: { executeCommand: m.command } })
  m.get.mockResolvedValue({ id: "sandbox", delete: m.delete })
  m.createSession.mockResolvedValue({ start: m.start })
  m.getSession.mockResolvedValue({ cancel: vi.fn() })
})
afterEach(() => { vi.unstubAllEnvs() })
describe("home uses the existing workspace agent", () => {
  it("uses its configured model and credential resolver, then persists a resumable session", async () => {
    const result = await generateHomePlan(operation(), { conversations: [] }, "lease")
    expect(m.credentials).toHaveBeenCalledWith("u", expect.objectContaining({ agent: "opencode", model: "opencode-go/glm-5.2" }))
    expect(m.createSession).toHaveBeenCalledWith("opencode", expect.objectContaining({ model: "opencode-go/glm-5.2", env: expect.objectContaining({ OPENCODE_API_KEY: "existing-test-credential" }) }))
    expect(m.db.homeOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { runtime: expect.objectContaining({ sandboxId: "sandbox" }) } }))
    expect(m.start).toHaveBeenCalledOnce(); expect(result.complete).toBe(false)
  })
  it("honours shared-budget rejection before creating a sandbox", async () => {
    m.credentials.mockResolvedValue(Response.json({ message: "Daily budget spent" }, { status: 429 }))
    await expect(generateHomePlan(operation(), {}, "lease")).rejects.toThrow(/budget/)
    expect(m.create).not.toHaveBeenCalled()
  })
  it("does not start an agent after cancellation or revoked membership", async () => {
    m.db.homeOperation.findFirst.mockResolvedValue(null)
    await expect(generateHomePlan(operation(), {}, "lease")).rejects.toThrow(/access changed/)
    expect(m.start).not.toHaveBeenCalled()
  })
  it("reattaches to running work instead of launching another agent", async () => {
    m.snapshot.mockResolvedValue({ status: "running", content: "", sessionId: "provider-session" })
    const result = await generateHomePlan(operation({ runtime: runtime() }), {}, "lease")
    expect(m.create).not.toHaveBeenCalled(); expect(result.complete).toBe(false)
    expect(m.get).toHaveBeenCalledWith("sandbox")
  })
  it("deletes a failed startup even when no session metadata was written", async () => {
    m.db.homeOperation.findUnique.mockResolvedValue(operation({ status: "failed", runtime: runtime() }))
    m.getSession.mockRejectedValue(new Error("No session metadata"))
    await cleanupHomeRuntime("home-op")
    expect(m.delete).toHaveBeenCalledOnce()
    expect(m.db.homeOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { runtime: expect.anything() } }))
  })
  it("releases the retry lock when the sandbox was already deleted", async () => {
    m.db.homeOperation.findUnique.mockResolvedValue(operation({ status: "failed", runtime: runtime() }))
    m.get.mockRejectedValue({ status: 404 })
    await cleanupHomeRuntime("home-op")
    expect(m.db.homeOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { runtime: expect.anything() } }))
  })
})
