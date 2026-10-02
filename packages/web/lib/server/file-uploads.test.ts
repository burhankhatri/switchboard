import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn() }, chat: { findFirst: vi.fn() },
  fileUpload: { updateMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  transaction: vi.fn(), deleteStoredFiles: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { workspace: mocks.workspace, chat: mocks.chat, fileUpload: mocks.fileUpload, $transaction: mocks.transaction } }))
vi.mock("./upload-storage", () => ({ deleteStoredFiles: mocks.deleteStoredFiles }))
import { assertUploadAccess, claimUploads, consumeUploads, releaseUploads, cleanupExpiredUploads } from "./file-uploads"

describe("upload ownership and lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.findFirst.mockResolvedValue({ id: "ws" })
    mocks.transaction.mockImplementation(fn => fn({ fileUpload: mocks.fileUpload }))
    mocks.fileUpload.updateMany.mockResolvedValue({ count: 1 })
    mocks.deleteStoredFiles.mockResolvedValue(undefined)
  })
  it("rejects a removed workspace member", async () => {
    mocks.workspace.findFirst.mockResolvedValue(null)
    await expect(assertUploadAccess("outsider", { kind: "workspace", id: "ws" })).rejects.toMatchObject({ status: 403 })
  })
  it("checks membership even for the owner of a workspace chat", async () => {
    mocks.chat.findFirst.mockResolvedValue({ workspaceId: "ws" })
    mocks.workspace.findFirst.mockResolvedValue(null)
    await expect(claimUploads("user", { kind: "chat", id: "chat" }, ["upload"], 20)).rejects.toMatchObject({ status: 403 })
    expect(mocks.fileUpload.updateMany).not.toHaveBeenCalled()
  })
  it("rejects foreign, consumed, expired or busy IDs without reading their objects", async () => {
    mocks.fileUpload.updateMany.mockResolvedValue({ count: 0 })
    await expect(claimUploads("user", { kind: "workspace", id: "ws" }, ["foreign"], 200)).rejects.toThrow("expired")
    expect(mocks.fileUpload.findMany).not.toHaveBeenCalled()
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
  })
  it("preserves request order and rejects aggregate overflow", async () => {
    mocks.fileUpload.updateMany.mockResolvedValue({ count: 2 })
    mocks.fileUpload.findMany.mockResolvedValue([{ id: "b", size: 1 }, { id: "a", size: 1 }])
    const claim = await claimUploads("user", { kind: "workspace", id: "ws" }, ["a", "b"], 200)
    expect(claim.uploads.map(f => f.id)).toEqual(["a", "b"])
    mocks.fileUpload.findMany.mockResolvedValue([{ id: "a", size: 100 * 1024 * 1024 }, { id: "b", size: 1 }])
    await expect(claimUploads("user", { kind: "workspace", id: "ws" }, ["a", "b"], 200)).rejects.toThrow("100 MB")
  })
  it("release after a failed transfer keeps staged objects for retry", async () => {
    await releaseUploads({ token: "lease", uploads: [{ id: "upload", objectPath: "object" }] as never })
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
    expect(mocks.fileUpload.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { claimToken: null, claimUntil: null } }))
  })
  it("consumption removes bytes but keeps a tombstone for late signed uploads", async () => {
    await consumeUploads({ token: "lease", uploads: [{ id: "upload", objectPath: "object" }] as never })
    expect(mocks.deleteStoredFiles).toHaveBeenCalledWith(["object"])
    expect(mocks.fileUpload.deleteMany).not.toHaveBeenCalled()
  })
  it("cleanup filters out retained assets and active claims", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key")
    mocks.fileUpload.findMany.mockResolvedValue([])
    expect(await cleanupExpiredUploads()).toBe(0)
    expect(mocks.fileUpload.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ asset: null }), take: 50 }))
    vi.unstubAllEnvs()
  })
})
