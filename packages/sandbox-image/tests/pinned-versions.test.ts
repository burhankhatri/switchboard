import { describe, it, expect } from "vitest"
import {
  AGENT_PACKAGES,
  AGENT_CLI_VERSIONS,
  agentInstallCommand,
  MIN_OPENCODE_VERSION,
} from "../src/image"

/**
 * Why this file exists.
 *
 * The image installed every agent CLI with a bare `npm install -g <pkg>`. The
 * command string never changed, so the build cache reused that layer on every
 * rebuild and the CLIs froze at whatever version they had the first time the
 * layer was built. A snapshot rebuilt on 2026-08-18 was still serving
 * opencode-ai@1.17.14, published 2026-07-06 — and OpenCode's free tier refuses
 * anything below 1.18.0, so every free-tier run failed with a version error
 * nobody could fix by rebuilding.
 *
 * tokscale was never affected, because its version is interpolated into the
 * command. That is the whole fix: put the version in the string.
 */

const npmAgents = Object.entries(AGENT_PACKAGES).filter(([, pkg]) => pkg !== "")

describe("agent CLI pinning", () => {
  it("pins every agent installed from npm", () => {
    // A missing pin is how the freeze happened; an unpinned package is not a
    // smaller problem than a stale one, it is the same problem.
    const unpinned = npmAgents.filter(([, pkg]) => !AGENT_CLI_VERSIONS[pkg])
    expect(unpinned.map(([agent]) => agent)).toEqual([])
  })

  it("pins to exact versions, never a range", () => {
    // `^1.18.0` in the command string is stable across rebuilds, so the layer
    // cache would still hand back 1.18.0 forever. Only an exact version makes
    // the string change when the pin changes.
    for (const [, pkg] of npmAgents) {
      expect(AGENT_CLI_VERSIONS[pkg], pkg).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it("puts the version in the install command, so a bump busts the cache", () => {
    for (const [, pkg] of npmAgents) {
      const cmd = agentInstallCommand(pkg)
      expect(cmd).toBe(`npm install -g ${pkg}@${AGENT_CLI_VERSIONS[pkg]}`)
    }
  })

  it("refuses to build a command for a package with no pin", () => {
    // Adding an agent without a pin should fail the build, not silently
    // reintroduce a floating install.
    expect(() => agentInstallCommand("some-new-agent-cli")).toThrow(/pin/i)
  })

  it("ships an opencode new enough for the free tier", () => {
    // The specific regression. OpenCode's free tier gates on this version, and
    // the failure surfaces to the user as a provider error mid-run.
    const pinned = AGENT_CLI_VERSIONS[AGENT_PACKAGES.opencode]
    const cmp = (a: string, b: string) => {
      const A = a.split(".").map(Number)
      const B = b.split(".").map(Number)
      for (let i = 0; i < 3; i++) if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0)
      return 0
    }
    expect(cmp(pinned, MIN_OPENCODE_VERSION)).toBeGreaterThanOrEqual(0)
  })
})
