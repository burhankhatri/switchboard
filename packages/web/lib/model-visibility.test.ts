import { describe, it, expect } from "vitest"
import { visibleModelOptions } from "./model-visibility"
import type { CredentialFlags, ModelOption } from "@switchboard/common"

/**
 * Of the 77 assistant turns in the first two months, 25 ran on the free
 * big-pickle and 4 on nemotron. The free models were where the sloppiness
 * lived (14% failed tool calls against 6% on GLM-5.2, real names in chat, a
 * draft created on an ambiguous ask). With a shared OpenCode key in place there
 * is no reason to offer them.
 */
const MODELS: ModelOption[] = [
  { value: "opencode/big-pickle", label: "Big Pickle", requiresKey: "none" },
  { value: "opencode/nemotron-3-ultra-free", label: "Nemotron", requiresKey: "none" },
  { value: "opencode-go/glm-5.2", label: "GLM 5.2", requiresKey: "opencode" },
  { value: "endpoint:abc", label: "My endpoint", requiresKey: "none" },
]

describe("visibleModelOptions", () => {
  it("hides free models for OpenCode when the shared key exists", () => {
    const flags = { OPENCODE_API_KEY_SHARED: true } as CredentialFlags
    expect(visibleModelOptions("opencode", MODELS, flags).map((m) => m.value)).toEqual([
      "opencode-go/glm-5.2",
      "endpoint:abc",
    ])
  })

  it("keeps them when there is no shared key to fall back on", () => {
    expect(visibleModelOptions("opencode", MODELS, {} as CredentialFlags)).toEqual(MODELS)
    expect(visibleModelOptions("opencode", MODELS, null)).toEqual(MODELS)
  })

  it("keeps a free model that is currently selected so the picker can show it", () => {
    const flags = { OPENCODE_API_KEY_SHARED: true } as CredentialFlags
    const shown = visibleModelOptions("opencode", MODELS, flags, "opencode/big-pickle")
    expect(shown.map((m) => m.value)).toContain("opencode/big-pickle")
    expect(shown.map((m) => m.value)).not.toContain("opencode/nemotron-3-ultra-free")
  })

  it("leaves other agents alone", () => {
    const kilo: ModelOption[] = [{ value: "kilo/kilo-auto/free", label: "Auto", requiresKey: "none" }]
    expect(visibleModelOptions("kilo", kilo, { OPENCODE_API_KEY_SHARED: true } as CredentialFlags)).toEqual(kilo)
  })
})
