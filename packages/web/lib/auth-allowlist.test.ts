import { describe, it, expect } from "vitest"

/**
 * The allowlist logic from the signIn callback, isolated.
 *
 * Worth testing on its own because the failure mode is silent and severe: get
 * it wrong open and a stranger can join a workspace and receive its
 * credentials; get it wrong closed and nobody can sign in at all.
 */
function isAllowed(login: string | undefined, raw: string | undefined): boolean {
  const allowed = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length === 0) return true
  return !!login && allowed.includes(login.toLowerCase())
}

describe("sign-in allowlist", () => {
  it("allows anyone when unset — local development", () => {
    expect(isAllowed("stranger", undefined)).toBe(true)
    expect(isAllowed("stranger", "")).toBe(true)
    expect(isAllowed("stranger", "   ")).toBe(true)
  })

  it("admits listed handles, case-insensitively", () => {
    expect(isAllowed("burhankhatri", "burhankhatri,chemicoholic21")).toBe(true)
    expect(isAllowed("BurhanKhatri", "burhankhatri")).toBe(true)
  })

  it("refuses everyone else once a list exists", () => {
    expect(isAllowed("stranger", "burhankhatri")).toBe(false)
  })

  it("refuses a caller with no login rather than defaulting open", () => {
    expect(isAllowed(undefined, "burhankhatri")).toBe(false)
  })

  it("tolerates whitespace and trailing commas in the env value", () => {
    expect(isAllowed("chemicoholic21", " burhankhatri , chemicoholic21 ,")).toBe(true)
  })
})
