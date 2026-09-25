import { describe, it, expect } from "vitest"
import { defaultModelAfterAgentChange } from "@/lib/default-model"

/**
 * Switching the default agent to OpenCode used to set the model to the first
 * entry in its list, the free opencode/big-pickle, even when the shared
 * OpenCode Go key was there to run GLM-5.2. The modal then saved that on close,
 * so every later run went to the free tier, where the gtm-lead-engine run
 * stalled for 300s on 2026-09-25.
 */
describe("defaultModelAfterAgentChange", () => {
  it("lands on the Go default when the shared OpenCode key is available", () => {
    expect(defaultModelAfterAgentChange("opencode", "default", { OPENCODE_API_KEY_SHARED: true })).toBe(
      "opencode-go/glm-5.2"
    )
  })

  it("falls back to a free model only when no OpenCode key is usable", () => {
    expect(defaultModelAfterAgentChange("opencode", "default", {})).toBe("opencode/big-pickle")
  })

  it("keeps a model the user can already run", () => {
    expect(
      defaultModelAfterAgentChange("opencode", "opencode-go/kimi-k2.6", { OPENCODE_API_KEY_SHARED: true })
    ).toBe("opencode-go/kimi-k2.6")
  })
})
