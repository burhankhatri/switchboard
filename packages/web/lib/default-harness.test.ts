import { describe, it, expect } from "vitest"
import { DEFAULT_HARNESS, agentModelForNewChat, workspaceHarness } from "@/lib/default-harness"

/**
 * OpenCode on GLM-5.2 is the default everywhere until someone changes it.
 *
 * Two places disagreed with that. New workspaces were created with agent
 * "claude", and a new chat was created before its first message with whatever
 * the draft recorded, usually nothing, so the server filled in the workspace's
 * "claude". The chat then flipped to OpenCode when the message went out, and
 * the UI showed "Claude is responding" for a moment first.
 */
describe("default harness", () => {
  it("is OpenCode on GLM-5.2", () => {
    expect(DEFAULT_HARNESS).toEqual({ agent: "opencode", model: "opencode-go/glm-5.2" })
  })
})

describe("workspaceHarness", () => {
  it("defaults a new workspace to OpenCode on GLM-5.2", () => {
    expect(workspaceHarness({})).toEqual({ agent: "opencode", model: "opencode-go/glm-5.2" })
  })

  it("keeps an explicitly chosen agent and does not pin another agent's model", () => {
    expect(workspaceHarness({ agent: "codex" })).toEqual({ agent: "codex", model: null })
    expect(workspaceHarness({ agent: "opencode", model: "opencode-go/kimi-k2.6" })).toEqual({
      agent: "opencode",
      model: "opencode-go/kimi-k2.6",
    })
  })
})

describe("agentModelForNewChat", () => {
  it("creates the chat with the agent and model being sent", () => {
    expect(
      agentModelForNewChat({ agent: null, model: null }, { agent: "opencode", model: "opencode-go/glm-5.2" })
    ).toEqual({ agent: "opencode", model: "opencode-go/glm-5.2" })
  })

  it("prefers what is sent over what the draft recorded", () => {
    expect(
      agentModelForNewChat({ agent: "claude-code", model: "default" }, { agent: "opencode", model: "opencode-go/glm-5.2" })
    ).toEqual({ agent: "opencode", model: "opencode-go/glm-5.2" })
  })

  it("falls back to the draft when nothing is sent", () => {
    expect(agentModelForNewChat({ agent: "opencode", model: "opencode-go/kimi-k2.6" }, {})).toEqual({
      agent: "opencode",
      model: "opencode-go/kimi-k2.6",
    })
  })
})
