import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), asset: vi.fn(), readRaw: vi.fn(), signedUrl: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireGitHubAuth: mocks.auth, isGitHubAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
  forbidden: (error: string) => Response.json({ error }, { status: 403 }),
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  internalError: () => Response.json({ error: "Read failed" }, { status: 500 }),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { workspace: { findFirst: mocks.workspace }, workspaceAsset: { findUnique: mocks.asset } } }))
vi.mock("@/lib/workspace-repo", () => ({ readWorkspaceFileRaw: mocks.readRaw }))
vi.mock("@/lib/server/upload-storage", () => ({ signedDownloadUrl: mocks.signedUrl }))
import { GET } from "./route"

const workspace = { path: "workspaces/demo", baseBranch: "team", members: [{ userId: "member" }] }
function get(path: string | null) {
  const url = new URL("http://localhost/api/workspaces/ws/files/raw")
  if (path !== null) url.searchParams.set("path", path)
  return GET(new Request(url) as unknown as NextRequest & { nextUrl: URL }, { params: Promise.resolve({ id: "ws" }) })
}

describe("GET /api/workspaces/:id/files/raw", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ userId: "member", token: "personal" })
    mocks.workspace.mockResolvedValue(workspace)
    mocks.asset.mockResolvedValue(null)
  })

  it("streams a Git file as a download that can never render as a page", async () => {
    mocks.readRaw.mockResolvedValue({ stream: new Response(new Uint8Array([1, 2, 3])).body, size: 3 })
    const response = await get("workspaces/demo/Electric Company/Chariot.xlsm")

    expect(mocks.readRaw).toHaveBeenCalledWith("personal", "workspaces/demo/Electric Company/Chariot.xlsm", "team")
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    expect(response.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Chariot.xlsm")
    expect(response.headers.get("content-length")).toBe("3")
  })

  it("redirects a retained Storage asset to a short-lived signed URL without touching Git", async () => {
    mocks.asset.mockResolvedValue({ upload: { objectPath: "member/object", name: "Big Book.xlsm" } })
    mocks.signedUrl.mockResolvedValue("https://project.supabase.co/storage/v1/object/sign/x?token=t")
    const response = await get("workspaces/demo/Big Book.xlsm")

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://project.supabase.co/storage/v1/object/sign/x?token=t")
    expect(mocks.signedUrl).toHaveBeenCalledWith("member/object", "Big Book.xlsm")
    expect(mocks.readRaw).not.toHaveBeenCalled()
  })

  it("serves the shared root's files", async () => {
    mocks.readRaw.mockResolvedValue({ stream: new Response("x").body, size: null })
    expect((await get(".claude/skills/guide/logo.png")).status).toBe(200)
  })

  it("refuses non-members before reading anything", async () => {
    mocks.auth.mockResolvedValue({ userId: "stranger", token: "personal" })
    expect((await get("workspaces/demo/Chariot.xlsm")).status).toBe(403)
    expect(mocks.readRaw).not.toHaveBeenCalled()
    expect(mocks.asset).not.toHaveBeenCalled()
  })

  it("refuses another workspace's path, traversal and a missing path", async () => {
    expect((await get("workspaces/other/secret.csv")).status).toBe(403)
    expect((await get("workspaces/demo/../other/secret.csv")).status).toBe(400)
    expect((await get(null)).status).toBe(400)
    expect(mocks.readRaw).not.toHaveBeenCalled()
  })

  it("reports a file GitHub no longer has as 404", async () => {
    mocks.readRaw.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }))
    expect((await get("workspaces/demo/gone.xlsx")).status).toBe(404)
  })
})
