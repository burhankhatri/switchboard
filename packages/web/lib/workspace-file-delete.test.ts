import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("Git file deletion", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("WORKSPACES_REPO", "owner/repo"); vi.stubEnv("WORKSPACES_REPO_TOKEN", "service") })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  it("encodes the path, uses the service token and supplies the branch and expected SHA", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetch)
    const { deleteWorkspaceFile } = await import("./workspace-repo")
    await deleteWorkspaceFile("personal", "workspaces/demo/a #.csv", "sha", "Delete by Member", "team")
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/workspaces/demo/a%20%23.csv", expect.objectContaining({
      method: "DELETE", headers: expect.objectContaining({ Authorization: "Bearer service" }),
      body: JSON.stringify({ message: "Delete by Member", sha: "sha", branch: "team" }),
    }))
  })
  it("reports changed files without clearing the conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 409 })))
    const { deleteWorkspaceFile } = await import("./workspace-repo")
    await expect(deleteWorkspaceFile("token", "workspaces/demo/file", "old", "Delete")).rejects.toMatchObject({ status: 409 })
  })
  it("rejects traversal and missing versions before contacting GitHub", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { deleteWorkspaceFile } = await import("./workspace-repo")
    await expect(deleteWorkspaceFile("token", "workspaces/demo/../other", "sha", "Delete")).rejects.toThrow("Invalid")
    await expect(deleteWorkspaceFile("token", "workspaces/demo/file", "", "Delete")).rejects.toThrow("Invalid")
    expect(fetch).not.toHaveBeenCalled()
  })
  it("reads the delete confirmation version from the workspace branch", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ sha: "team-sha", encoding: "base64", content: "YQ==" }))
    vi.stubGlobal("fetch", fetch)
    const { readWorkspaceFile } = await import("./workspace-repo")
    expect((await readWorkspaceFile("token", "workspaces/demo/file", "team/branch")).sha).toBe("team-sha")
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("?ref=team%2Fbranch"), expect.anything())
  })
  it("still reads the delete confirmation version of a file too large for GitHub to inline", async () => {
    // GitHub's Contents API omits the body of any blob over 1 MB but still returns its sha.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ type: "file", size: 3033176, encoding: "none", content: "", sha: "big-sha" })))
    const { readWorkspaceFile } = await import("./workspace-repo")
    expect(await readWorkspaceFile("token", "workspaces/demo/chariot.xlsm", "main")).toEqual({ content: "", truncated: true, sha: "big-sha" })
  })
})
