import { beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_GIT_FILE_BYTES } from "@/lib/upload-limits"
const mocks = vi.hoisted(() => ({
  claim: vi.fn(), release: vi.fn(), consume: vi.fn(), download: vi.fn(), verify: vi.fn(), remove: vi.fn(),
  list: vi.fn(), commit: vi.fn(), findAssets: vi.fn(), upsert: vi.fn(), update: vi.fn(), user: vi.fn(), transaction: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { workspaceAsset: { findMany: mocks.findAssets }, user: { findUnique: mocks.user }, $transaction: mocks.transaction } }))
vi.mock("./file-uploads", async importOriginal => ({ ...await importOriginal<typeof import("./file-uploads")>(), claimUploads: mocks.claim, releaseUploads: mocks.release, consumeUploads: mocks.consume }))
vi.mock("./upload-storage", () => ({ downloadStoredFile: mocks.download, verifyStoredSize: mocks.verify, deleteStoredFiles: mocks.remove }))
vi.mock("@/lib/workspace-repo", () => ({ listWorkspaceFiles: mocks.list, commitWorkspaceFiles: mocks.commit }))
import { importStagedWorkspaceFiles } from "./workspace-assets"

const options = { userId: "user", token: "github", workspaceId: "ws", base: "workspaces/demo", branch: "main", slug: "demo", folder: "folder" }
describe("workspace storage imports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.release.mockResolvedValue(undefined)
    mocks.consume.mockResolvedValue(undefined)
    mocks.verify.mockResolvedValue(undefined)
    mocks.list.mockResolvedValue({ workspace: [], shared: [] })
    mocks.findAssets.mockResolvedValue([])
    mocks.user.mockResolvedValue({ name: "User" })
    mocks.commit.mockResolvedValue({ commit: "sha", committed: 1 })
    mocks.transaction.mockImplementation(fn => fn({ workspaceAsset: { upsert: mocks.upsert }, fileUpload: { update: mocks.update } }))
  })
  it("commits only small bytes and retains the large object at its relative path", async () => {
    mocks.claim.mockResolvedValue({ token: "lease", uploads: [
      { id: "small", size: 3, objectPath: "small-object" },
      { id: "large", size: MAX_GIT_FILE_BYTES + 1, objectPath: "large-object" },
    ] })
    mocks.download.mockResolvedValue(Buffer.from([0, 255, 128]))
    const result = await importStagedWorkspaceFiles({ ...options, incoming: [
      { relativePath: "folder/script.txt", uploadId: "small" },
      { relativePath: "folder/dataset.csv", uploadId: "large" },
    ] })
    expect(result).toMatchObject({ committed: 2, retained: 1 })
    expect(mocks.commit.mock.calls[0][1]).toEqual([{ path: "workspaces/demo/folder/script.txt", contentBase64: Buffer.from([0, 255, 128]).toString("base64") }])
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { workspaceId: "ws", path: "workspaces/demo/folder/dataset.csv", uploadId: "large" } }))
    expect(mocks.consume.mock.calls[0][0].uploads.map((u: { id: string }) => u.id)).toEqual(["small"])
  })
  it("rejects a path collision with Git before reading or retaining bytes", async () => {
    mocks.claim.mockResolvedValue({ token: "lease", uploads: [{ id: "large", size: MAX_GIT_FILE_BYTES + 1, objectPath: "object" }] })
    mocks.list.mockResolvedValue({ workspace: [{ path: "workspaces/demo/data.csv" }], shared: [] })
    await expect(importStagedWorkspaceFiles({ ...options, incoming: [{ relativePath: "data.csv", uploadId: "large" }] })).rejects.toThrow("different file store")
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalled()
  })
  it("keeps staged files for retry if the Git commit fails", async () => {
    mocks.claim.mockResolvedValue({ token: "lease", uploads: [{ id: "small", size: 3, objectPath: "object" }] })
    mocks.download.mockResolvedValue(Buffer.from("abc"))
    mocks.commit.mockRejectedValue(new Error("Someone else pushed"))
    await expect(importStagedWorkspaceFiles({ ...options, incoming: [{ relativePath: "data.csv", uploadId: "small" }] })).rejects.toThrow("Someone else pushed")
    expect(mocks.consume).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalled()
  })
  it("refuses cross-workspace paths before any remote transfer", async () => {
    mocks.claim.mockResolvedValue({ token: "lease", uploads: [{ id: "file", size: 3, objectPath: "object" }] })
    await expect(importStagedWorkspaceFiles({ ...options, incoming: [{ relativePath: "../other/data.csv", uploadId: "file" }] })).rejects.toThrow("Nothing")
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })
})
