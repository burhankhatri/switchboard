import { describe, it, expect } from "vitest"
import { ALL_AGENTS, resolveAgent } from "@/lib/types"
// Not re-exported through lib/types; the default lives with the agent registry.
import { agentSlugs, getDefaultAgent } from "@switchboard/common"

/**
 * These values arrive from places a human writes them by hand — workspace.yaml,
 * user settings, a URL — so they have to be normalised, not trusted.
 */
describe("resolveAgent", () => {
  it("passes through a canonical id", () => {
    expect(resolveAgent("opencode", null)).toBe("opencode")
  })

  it("resolves the documented alias for claude-code", () => {
    // "claude" is the natural thing to type in a workspace.yaml and is a
    // documented alias. It used to pass through unnormalised, miss every agent
    // lookup, be judged unusable, and be silently replaced by the default — so
    // a workspace that asked for Claude Code quietly ran something else.
    expect(resolveAgent("claude", null)).toBe("claude-code")
  })

  it("is case-insensitive", () => {
    expect(resolveAgent("Claude", null)).toBe("claude-code")
    expect(resolveAgent("OpenCode", null)).toBe("opencode")
  })

  it("falls back to the settings default when nothing is preferred", () => {
    expect(resolveAgent(null, "claude")).toBe("claude-code")
  })

  it("falls back to the default agent for an unknown value", () => {
    expect(resolveAgent("not-a-real-agent", null)).toBe(getDefaultAgent())
  })

  it("resolves the other documented alias", () => {
    // droid is a valid agent id even though ALL_AGENTS — the list the UI
    // offers — is narrowed to two harnesses. Resolution and availability are
    // different questions.
    expect(resolveAgent("factory", null)).toBe("droid")
  })

  it("never returns a value that is not a real agent id", () => {
    const CANONICAL = new Set(Object.values(agentSlugs))
    for (const input of ["claude", "Claude", "factory", "nonsense", null, undefined]) {
      expect(CANONICAL.has(resolveAgent(input, null))).toBe(true)
    }
  })
})
