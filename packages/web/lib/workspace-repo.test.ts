import { describe, it, expect } from "vitest"
import { chooseGitToken, isWorkspacesRepo } from "./workspace-repo"

const base = {
  repo: "burhankhatri/agent-workspaces",
  workspacesRepo: "burhankhatri/agent-workspaces",
  serviceToken: "svc",
  userToken: "user",
}

describe("isWorkspacesRepo", () => {
  it("matches regardless of case, as GitHub does", () => {
    expect(isWorkspacesRepo("BurhanKhatri/Agent-Workspaces", base.workspacesRepo)).toBe(true)
  })

  it("never matches when no workspaces repo is configured", () => {
    expect(isWorkspacesRepo("", "")).toBe(false)
  })
})

describe("chooseGitToken", () => {
  it("gives a member the service token for the workspaces repo", () => {
    expect(chooseGitToken({ ...base, isWorkspaceMember: true })).toBe("svc")
  })

  it("keeps a non-member on their own token, so naming the repo is not enough", () => {
    expect(chooseGitToken({ ...base, isWorkspaceMember: false })).toBe("user")
  })

  it("keeps the user's token for any other repo", () => {
    expect(chooseGitToken({ ...base, repo: "someone/app", isWorkspaceMember: true })).toBe("user")
  })

  it("falls back to the user's token when no service token is configured", () => {
    expect(chooseGitToken({ ...base, serviceToken: "", isWorkspaceMember: true })).toBe("user")
  })
})
