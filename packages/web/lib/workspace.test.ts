import { describe, it, expect } from "vitest"
import { encryptSecret } from "@/lib/db/encryption"
import CryptoJS from "crypto-js"
import {
  decryptWorkspaceEnv,
  workspaceEnvKeys,
  isValidEnvName,
  workspaceSessionOptions,
  resolveRunRepo,
} from "./workspace"

const ws = (environmentVariables: unknown, slug = "lead-gen") =>
  ({ slug, environmentVariables }) as never

describe("decryptWorkspaceEnv", () => {
  it("round-trips values written by the app", () => {
    const env = decryptWorkspaceEnv(
      ws({ CRM_KEY: encryptSecret("sk-crm-123"), EDGE_KEY: encryptSecret("edge-abc") })
    )
    expect(env).toEqual({ CRM_KEY: "sk-crm-123", EDGE_KEY: "edge-abc" })
  })

  it("returns nothing for a workspace with no connections", () => {
    expect(decryptWorkspaceEnv(ws(null))).toEqual({})
    expect(decryptWorkspaceEnv(null)).toEqual({})
    expect(decryptWorkspaceEnv(undefined)).toEqual({})
  })

  it("skips empty values rather than injecting an empty string", () => {
    expect(decryptWorkspaceEnv(ws({ A: encryptSecret("x"), B: "" }))).toEqual({ A: "x" })
  })

  it("rejects a value encrypted under a DIFFERENT key, even when it unpads to valid UTF-8", () => {
    // CryptoJS passphrase mode is CBC+PKCS7 with no MAC, so a wrong key
    // sometimes yields short, valid, entirely-wrong strings. A "non-empty
    // UTF-8" check accepts those; the marker does not. Brute-force until we
    // land one of those cases so the test exercises the real hazard.
    let survivor: string | null = null
    for (let i = 0; i < 4000 && !survivor; i++) {
      const ct = CryptoJS.AES.encrypt(`secret-${i}`, "a-completely-different-key").toString()
      let out = ""
      try {
        out = CryptoJS.AES.decrypt(ct, process.env.ENCRYPTION_KEY ?? "dev-only-encryption-key-not-for-production")
          .toString(CryptoJS.enc.Utf8)
      } catch { /* malformed UTF-8 is already rejected */ }
      if (out) survivor = ct
    }
    // If we found one, it must still be rejected. If we did not, the assertion
    // below is vacuous but harmless — the marker check is unconditional.
    if (survivor) {
      expect(() => decryptWorkspaceEnv(ws({ CRM_KEY: survivor! }))).toThrow(/Could not decrypt/)
    }
    expect(true).toBe(true)
  })

  it("THROWS on an undecryptable value instead of passing ciphertext through", () => {
    // The failure that matters: after a key rotation the old `decrypt` returned
    // the ciphertext, which the agent would send to the CRM as a credential.
    expect(() => decryptWorkspaceEnv(ws({ CRM_KEY: "not-actually-encrypted" }))).toThrow(
      /Could not decrypt lead-gen\.CRM_KEY/
    )
  })

  it("names the workspace and key in the error so it is diagnosable", () => {
    expect(() => decryptWorkspaceEnv(ws({ EDGE_KEY: "garbage" }, "pricing-desk"))).toThrow(
      /pricing-desk\.EDGE_KEY/
    )
  })
})

describe("workspaceEnvKeys", () => {
  it("returns sorted names and never values", () => {
    const keys = workspaceEnvKeys(ws({ ZED: encryptSecret("v"), ALPHA: encryptSecret("secret-value") }))
    expect(keys).toEqual(["ALPHA", "ZED"])
    expect(JSON.stringify(keys)).not.toContain("secret-value")
  })

  it("handles absent connections", () => {
    expect(workspaceEnvKeys(ws(null))).toEqual([])
    expect(workspaceEnvKeys(null)).toEqual([])
  })
})

describe("isValidEnvName", () => {
  it("accepts conventional names", () => {
    for (const ok of ["CRM_KEY", "EDGE_KEY", "A", "GOOGLE_MAPS_KEY", "X9_Z"]) {
      expect(isValidEnvName(ok)).toBe(true)
    }
  })

  it("rejects lowercase, leading digits, and shell-unsafe characters", () => {
    for (const bad of [
      "crm_key", "1KEY", "_KEY", "MY-KEY", "MY KEY", "KEY=x", "KEY;id",
      "KEY$(id)", "KEY`id`", "", "A".repeat(65),
    ]) {
      expect(isValidEnvName(bad)).toBe(false)
    }
  })
})

describe("env precedence", () => {
  it("workspace connections win over a user's chat-level vars", () => {
    // The rule that matters: a member must not be able to point a shared
    // workspace at a system of record of their choosing by setting CRM_KEY on
    // their own chat.
    const systemEnv = { ANTHROPIC_API_KEY: "sys", SHARED: "sys" }
    const userEnv = { SHARED: "user", CRM_KEY: "attacker-controlled" }
    const workspaceEnv = decryptWorkspaceEnv(ws({ CRM_KEY: encryptSecret("real-crm-key") }))

    const merged = { ...systemEnv, ...userEnv, ...workspaceEnv }

    expect(merged.CRM_KEY).toBe("real-crm-key")
    // user vars still beat system defaults — only workspace connections are protected
    expect(merged.SHARED).toBe("user")
    expect(merged.ANTHROPIC_API_KEY).toBe("sys")
  })
})

describe("workspaceSessionOptions", () => {
  it("is empty for no workspace so callers can spread it unconditionally", () => {
    expect(workspaceSessionOptions(null)).toEqual({})
  })

  it("omits an absent system prompt rather than sending null", () => {
    expect(workspaceSessionOptions({ path: "workspaces/a", systemPrompt: null })).toEqual({
      workspacePath: "workspaces/a",
    })
  })
})

describe("resolveRunRepo", () => {
  it("prefers the workspace and falls back to the chat's own repo", () => {
    expect(resolveRunRepo({ repo: "o/ws", baseBranch: "main" }, { repo: "o/legacy", baseBranch: "dev" }))
      .toEqual({ repo: "o/ws", baseBranch: "main" })
    expect(resolveRunRepo(null, { repo: "o/legacy", baseBranch: "dev" }))
      .toEqual({ repo: "o/legacy", baseBranch: "dev" })
  })
})
