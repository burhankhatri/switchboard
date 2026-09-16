import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { schedulerMcpServer } from "./scheduler-server"
import { verifyRunToken } from "./run-token"

const ORIGINAL = { ...process.env }

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-run-tokens"
  delete process.env.SANDBOX_CALLBACK_ORIGIN
  delete process.env.NEXTAUTH_URL
  delete process.env.VERCEL_URL
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.restoreAllMocks()
})

const run = { userId: "u1", workspaceId: "w1", chatId: "c1" }

describe("schedulerMcpServer", () => {
  it("points the sandbox at the configured public origin", () => {
    process.env.SANDBOX_CALLBACK_ORIGIN = "https://agents.example.com"
    const server = schedulerMcpServer(run)
    expect(server?.url).toBe("https://agents.example.com/api/mcp/scheduler")
    expect(server?.name).toBe("scheduler")
  })

  it("mints a token carrying this run's claims", () => {
    process.env.SANDBOX_CALLBACK_ORIGIN = "https://agents.example.com"
    expect(verifyRunToken(schedulerMcpServer(run)!.bearerToken)).toMatchObject(run)
  })

  it("refuses a localhost origin rather than handing over an unreachable URL", () => {
    // This is the case that produced a real bug: the tool was silently absent,
    // so the agent wrote a crontab inside a sandbox that was about to be
    // destroyed and reported it as scheduled.
    for (const local of [
      "http://localhost:4000",
      "http://127.0.0.1:4000",
      "https://localhost",
    ]) {
      process.env.NEXTAUTH_URL = local
      expect(schedulerMcpServer(run)).toBeNull()
    }
  })

  it("says so in the log when it cannot offer the tool", () => {
    process.env.NEXTAUTH_URL = "http://localhost:4000"
    schedulerMcpServer(run)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("SANDBOX_CALLBACK_ORIGIN")
    )
  })

  it("prefers the explicit callback origin over the auth URL", () => {
    // The two are separate on purpose: NEXTAUTH_URL is also the OAuth callback
    // base, so pointing it at a tunnel to test this would break sign-in.
    process.env.NEXTAUTH_URL = "http://localhost:4000"
    process.env.SANDBOX_CALLBACK_ORIGIN = "https://tunnel.example.com"
    expect(schedulerMcpServer(run)?.url).toBe("https://tunnel.example.com/api/mcp/scheduler")
  })

  it("falls back to the deployment URL when nothing is configured", () => {
    process.env.VERCEL_URL = "preview-abc.vercel.app"
    expect(schedulerMcpServer(run)?.url).toBe(
      "https://preview-abc.vercel.app/api/mcp/scheduler"
    )
  })

  it("trims a trailing slash instead of doubling it", () => {
    process.env.SANDBOX_CALLBACK_ORIGIN = "https://agents.example.com/"
    expect(schedulerMcpServer(run)?.url).toBe("https://agents.example.com/api/mcp/scheduler")
  })

  it("offers nothing to a run with no workspace", () => {
    process.env.SANDBOX_CALLBACK_ORIGIN = "https://agents.example.com"
    expect(schedulerMcpServer({ ...run, workspaceId: null })).toBeNull()
  })
})
