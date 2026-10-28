import { describe, it, expect } from "vitest"
import { finalTurnContent } from "./turn-outcome"
import type { AgentSnapshot } from "@/lib/agent-session"

function snap(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    status: "completed",
    content: "",
    toolCalls: [],
    contentBlocks: [],
    sessionId: "sess-1",
    ...overrides,
  }
}

/**
 * Why this exists: three of Wayne's first messages (pricing-bot, 2026-09-22)
 * each got an assistant message with empty content and isError=false. The
 * provider had rejected the run ("OpenCode 1.18.0 or newer is required to use
 * the free tier") and the error went to the activity log and the live SSE
 * banner, but nothing was written into the message, so on reload the chat
 * showed a blank reply and he sent the same prompt three times.
 */
describe("finalTurnContent", () => {
  it("leaves a normal completed turn alone", () => {
    const out = finalTurnContent(snap({ content: "Done.\n" }))
    expect(out).toEqual({ content: "Done.\n", isError: false })
  })

  it("does not flag a completed turn that only ran tools", () => {
    const out = finalTurnContent(
      snap({ toolCalls: [{ tool: "Bash", summary: "Bash: ls" }] })
    )
    expect(out.isError).toBe(false)
    expect(out.content).toBe("")
  })

  it("writes a visible stop line when a turn ends in error with no text", () => {
    const out = finalTurnContent(snap({ status: "error", error: "Error from provider (Console): 402 payment required" }))
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/^Agent stopped: /)
    expect(out.content).toContain("402 payment required")
  })

  it("keeps the agent's partial text above the stop line", () => {
    const out = finalTurnContent(snap({ status: "error", content: "Starting the audit…\n", error: "socket hang up" }))
    expect(out.content.startsWith("Starting the audit…\n")).toBe(true)
    expect(out.content).toContain("Agent stopped: socket hang up")
    expect(out.isError).toBe(true)
  })

  it("names the fix for the free-tier version error", () => {
    const out = finalTurnContent(
      snap({ status: "error", error: "Error from provider (Console): OpenCode 1.18.0 or newer is required to use the free tier" })
    )
    expect(out.content).toMatch(/OpenCode 1\.18/)
    expect(out.content).toMatch(/model menu|another model|different model/i)
  })

  it("explains an empty completed turn instead of leaving it blank", () => {
    const out = finalTurnContent(snap())
    expect(out.isError).toBe(true)
    expect(out.content.trim().length).toBeGreaterThan(0)
    expect(out.content).toMatch(/nothing|no reply|empty/i)
  })

  it("never returns an empty string for a terminal error", () => {
    const out = finalTurnContent(snap({ status: "error" }))
    expect(out.content.trim().length).toBeGreaterThan(0)
    expect(out.isError).toBe(true)
  })
})
