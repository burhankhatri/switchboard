import { describe, it, expect } from "vitest"
import { SANDBOX_APT_TOOLS, sandboxToolingCommand, getAgentSandboxImage } from "../src/image"

/**
 * About 20 of the 54 failed tool calls in the first two months of transcripts
 * were the sandbox, not the model: `python: command not found` (scripts are
 * documented as `python3` but models type `python`), `jq: not found`, a Python
 * `requests` import, and `/tmp/opencode: Permission denied` — OpenCode's own
 * tool-output directory is created root-owned in the image, and the agent runs
 * as `daytona`.
 */
describe("sandbox tooling", () => {
  it("installs jq, requests and a python that is python3", () => {
    expect(SANDBOX_APT_TOOLS).toContain("jq")
    expect(SANDBOX_APT_TOOLS).toContain("python3-requests")
    expect(SANDBOX_APT_TOOLS).toContain("python-is-python3")
    const cmd = sandboxToolingCommand()
    for (const pkg of SANDBOX_APT_TOOLS) expect(cmd).toContain(pkg)
  })

  it("pre-creates OpenCode's temp dirs owned by the sandbox user", () => {
    const cmd = sandboxToolingCommand()
    expect(cmd).toMatch(/mkdir -p \/tmp\/opencode \/tmp\/logs/)
    expect(cmd).toMatch(/chown -R daytona:daytona \/tmp\/opencode \/tmp\/logs/)
  })

  it("runs after the daytona user exists and before the image switches to it", () => {
    const dockerfile = getAgentSandboxImage().dockerfile
    const tooling = dockerfile.indexOf(sandboxToolingCommand())
    expect(tooling).toBeGreaterThan(-1)
    expect(tooling).toBeGreaterThan(dockerfile.indexOf("useradd"))
    expect(tooling).toBeLessThan(dockerfile.indexOf("USER daytona"))
  })
})
