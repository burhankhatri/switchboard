import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), asset: vi.fn(), removeAsset: vi.fn(), updateUpload: vi.fn(), user: vi.fn(),
  deleteStoredFiles: vi.fn(), deleteWorkspaceFile: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireGitHubAuth: mocks.auth, isGitHubAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  internalError: () => Response.json({ error: "Delete failed" }, { status: 500 }),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  workspace: { findFirst: mocks.workspace }, workspaceAsset: { findUnique: mocks.asset }, user: { findUnique: mocks.user },
  $transaction: (fn: (tx: unknown) => unknown) => fn({ workspaceAsset: { deleteMany: mocks.removeAsset }, fileUpload: { update: mocks.updateUpload } }),
} }))
vi.mock("@/lib/workspace-repo", () => ({ deleteWorkspaceFile: mocks.deleteWorkspaceFile }))
vi.mock("@/lib/server/upload-storage", () => ({ deleteStoredFiles: mocks.deleteStoredFiles }))
import { DELETE } from "./route"

const workspace = { slug: "demo", path: "workspaces/demo", baseBranch: "team", members: [{ userId: "member" }] }
const asset = { id: "asset", uploadId: "upload", upload: { objectPath: "member/object" } }
function request(body: unknown) {
  return DELETE(new Request("http://localhost/api/workspaces/ws/files", { method: "DELETE", body: JSON.stringify(body) }) as NextRequest, { params: Promise.resolve({ id: "ws" }) })
}
const file = { path: "workspaces/demo/data.csv", sha: "upload" }

describe("workspace file deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: "member", token: "token" })
    mocks.workspace.mockResolvedValue(workspace)
    mocks.asset.mockResolvedValue(asset)
    mocks.removeAsset.mockResolvedValue({ count: 1 })
    mocks.user.mockResolvedValue({ name: "Member" })
  })
  it("rejects unauthenticated callers without reading assets", async () => {
    mocks.auth.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }))
    expect((await request(file)).status).toBe(401)
    expect(mocks.asset).not.toHaveBeenCalled()
  })
  it("rejects removed members before changing backing stores", async () => {
    mocks.workspace.mockResolvedValue({ ...workspace, members: [] })
    expect((await request(file)).status).toBe(403)
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
    expect(mocks.deleteWorkspaceFile).not.toHaveBeenCalled()
  })
  it.each(["workspaces/other/data.csv", ".claude/skills/shared/SKILL.md", "workspaces/demo"])('rejects foreign/shared/folder root "%s"', async path => {
    expect((await request({ ...file, path })).status).toBe(403)
    expect(mocks.asset).not.toHaveBeenCalled()
  })
  it.each(["workspaces/demo/../other/file", "workspaces/demo/sub\\file", "workspaces/demo//file", "workspaces/demo/./file", "workspaces/demo/file\u0000", "workspaces/demo/sub/"])('rejects unsafe path "%s"', async path => {
    expect((await request({ ...file, path })).status).toBe(400)
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
  })
  it("requires an expected file version", async () => {
    expect((await request({ path: file.path })).status).toBe(400)
  })
  it("does not delete a replaced Storage object", async () => {
    expect((await request({ ...file, sha: "old-upload" })).status).toBe(409)
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
  })
  it("keeps metadata when Storage fails and permits retry", async () => {
    mocks.deleteStoredFiles.mockRejectedValueOnce(new Error("Storage unavailable"))
    expect((await request(file)).status).toBe(500)
    expect(mocks.removeAsset).not.toHaveBeenCalled()
    expect((await request(file)).status).toBe(200)
    expect(mocks.deleteStoredFiles).toHaveBeenCalledTimes(2)
  })
  it("deletes the exact private object and asset, retaining cleanup metadata", async () => {
    expect((await request(file)).status).toBe(200)
    expect(mocks.deleteStoredFiles).toHaveBeenCalledWith(["member/object"])
    expect(mocks.removeAsset).toHaveBeenCalledWith({ where: { id: "asset", uploadId: "upload" } })
    expect(mocks.updateUpload).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "upload" }, data: { consumedAt: expect.any(Date), expiresAt: expect.any(Date) } }))
    expect(mocks.deleteWorkspaceFile).not.toHaveBeenCalled()
  })
  it("does not remove a concurrent replacement's metadata", async () => {
    mocks.removeAsset.mockResolvedValue({ count: 0 })
    expect((await request(file)).status).toBe(409)
    expect(mocks.updateUpload).not.toHaveBeenCalled()
  })
  it("commits Git deletion on the workspace branch with member attribution", async () => {
    mocks.asset.mockResolvedValue(null)
    expect((await request({ ...file, sha: "git-sha" })).status).toBe(200)
    expect(mocks.deleteWorkspaceFile).toHaveBeenCalledWith("token", file.path, "git-sha", expect.stringContaining("Member"), "team")
    expect(mocks.deleteStoredFiles).not.toHaveBeenCalled()
  })
  it("reports a Git version conflict", async () => {
    mocks.asset.mockResolvedValue(null)
    mocks.deleteWorkspaceFile.mockRejectedValue(Object.assign(new Error("File changed"), { status: 409 }))
    expect((await request(file)).status).toBe(409)
  })
})
