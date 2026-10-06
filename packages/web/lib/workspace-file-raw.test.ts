import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("readWorkspaceFileRaw", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("WORKSPACES_REPO", "owner/repo"); vi.stubEnv("WORKSPACES_REPO_TOKEN", "service") })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it("streams the raw blob from the workspace branch, past the Contents API's 1 MB limit", async () => {
    const bytes = new Uint8Array(1_500_000).fill(7)
    const fetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } }))
    vi.stubGlobal("fetch", fetch)
    const { readWorkspaceFileRaw } = await import("./workspace-repo")

    const file = await readWorkspaceFileRaw("personal", "workspaces/demo/Electric Company/Chariot #1.xlsm", "team/branch")

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/contents/workspaces/demo/Electric%20Company/Chariot%20%231.xlsm?ref=team%2Fbranch",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer service", Accept: "application/vnd.github.raw" }) }),
    )
    expect(file.size).toBe(1_500_000)
    expect(new Uint8Array(await new Response(file.stream).arrayBuffer())).toEqual(bytes)
  })

  it("reports a missing file as a 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })))
    const { readWorkspaceFileRaw } = await import("./workspace-repo")
    await expect(readWorkspaceFileRaw("token", "workspaces/demo/gone.xlsx", "main")).rejects.toMatchObject({ status: 404 })
  })

  it("rejects traversal before contacting GitHub", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { readWorkspaceFileRaw } = await import("./workspace-repo")
    await expect(readWorkspaceFileRaw("token", "workspaces/demo/../other/secret.csv", "main")).rejects.toThrow("unsafe path")
    expect(fetch).not.toHaveBeenCalled()
  })
})
