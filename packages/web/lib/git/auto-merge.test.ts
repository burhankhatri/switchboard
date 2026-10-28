import { describe, it, expect, vi } from "vitest"
import { mergeDocOnlyBranch } from "./auto-merge"

/**
 * The GitHub side of landing documentation-only agent commits. The decision is
 * tested in doc-only-merge.test.ts; this covers that the merge is only
 * attempted when it says so, carries the right base and head, and that a
 * conflict or an unrelated failure is reported rather than thrown.
 */
function sandboxWith(diff: string) {
  return {
    process: {
      executeCommand: vi.fn(async (cmd: string) => ({
        exitCode: 0,
        result: cmd.includes("--name-status") ? diff : "",
      })),
    },
  }
}

const params = {
  repoPath: "/home/daytona/project",
  repo: "burhankhatri/agent-workspaces",
  branch: "agent/vivid-lunar",
  baseBranch: "main",
  workspacePath: "workspaces/gtm-lead-engine",
  token: "ghs_x",
}

describe("mergeDocOnlyBranch", () => {
  it("merges through the GitHub API when only documentation changed", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha: "abc" }), { status: 201 }))
    const out = await mergeDocOnlyBranch(
      { ...params, sandbox: sandboxWith("A\tworkspaces/gtm-lead-engine/campaigns/x/campaign.json\nM\tworkspaces/gtm-lead-engine/LEARNINGS.md\n") },
      fetchImpl
    )
    expect(out).toEqual({ merged: true, files: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.github.com/repos/burhankhatri/agent-workspaces/merges")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghs_x")
    expect(JSON.parse(init.body as string)).toMatchObject({ base: "main", head: "agent/vivid-lunar" })
  })

  it("does not call GitHub when a script changed", async () => {
    const fetchImpl = vi.fn()
    const out = await mergeDocOnlyBranch(
      { ...params, sandbox: sandboxWith("M\tworkspaces/gtm-lead-engine/scripts/push_to_instantly.py\n") },
      fetchImpl
    )
    expect(out).toMatchObject({ merged: false, reason: expect.stringContaining("not documentation") })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("reports a conflict instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Merge conflict" }), { status: 409 }))
    const out = await mergeDocOnlyBranch(
      { ...params, sandbox: sandboxWith("M\tworkspaces/gtm-lead-engine/LEARNINGS.md\n") },
      fetchImpl
    )
    expect(out).toMatchObject({ merged: false, reason: expect.stringContaining("409") })
  })

  it("treats 'already up to date' as nothing to do", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const out = await mergeDocOnlyBranch(
      { ...params, sandbox: sandboxWith("M\tworkspaces/gtm-lead-engine/LEARNINGS.md\n") },
      fetchImpl
    )
    expect(out).toEqual({ merged: false, reason: "already up to date" })
  })
})
