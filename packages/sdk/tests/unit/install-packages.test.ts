import { describe, it, expect } from "vitest"
import { getPackageName, getShellInstaller } from "../../src/utils/install"
import type { ProviderName } from "../../src/types/index"

/**
 * These names are typed as `string`, so nothing caught that the opencode entry
 * said "opencode" — a package that does not exist on npm. The map is only read
 * by ensureProvider(), which runs when `which <agent>` misses, so the image
 * having the binary baked in hid it: the install path was never reached on a
 * healthy sandbox, and on an unhealthy one it would fail with a 404 that reads
 * like a registry outage rather than a typo.
 */

const NPM_PACKAGES: Partial<Record<ProviderName, string>> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  copilot: "@github/copilot",
  kilo: "@kilocode/cli",
  // Published as opencode-ai. The bare name is not a package.
  opencode: "opencode-ai",
  gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent",
}

/** Providers that install via a shell script, so they carry no npm package. */
const SHELL_PROVIDERS: ProviderName[] = ["goose", "kimi", "droid"]

describe("provider install packages", () => {
  it("names each npm-installed CLI as it is actually published", () => {
    for (const [provider, pkg] of Object.entries(NPM_PACKAGES)) {
      expect(getPackageName(provider as ProviderName), provider).toBe(pkg)
    }
  })

  it("gives shell-installed providers an installer and no npm package", () => {
    for (const provider of SHELL_PROVIDERS) {
      expect(getShellInstaller(provider), provider).toBeTruthy()
      expect(getPackageName(provider), provider).toBe("")
    }
  })

  it("leaves the built-in provider with neither", () => {
    // eliza ships as an uploaded bundle; an install command for it would be a
    // bug, not a fallback.
    expect(getPackageName("eliza")).toBe("")
    expect(getShellInstaller("eliza")).toBeUndefined()
  })
})
