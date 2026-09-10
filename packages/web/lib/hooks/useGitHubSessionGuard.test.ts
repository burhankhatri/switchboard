import { describe, it, expect } from "vitest"
import { shouldEndSession } from "./useGitHubSessionGuard"

/**
 * The predicate behind an automatic sign-out, isolated.
 *
 * Worth testing alone for the same reason the sign-in allowlist is: both
 * failure directions are silent. Too eager and a healthy session is thrown away
 * mid-work with no error anyone can trace back here; too lax and the app sits
 * there looking signed in while every GitHub call 401s.
 */
describe("shouldEndSession", () => {
  it("ends the session on a definitive negative", () => {
    expect(shouldEndSession({ valid: false })).toBe(true)
  })

  it("leaves a healthy session alone", () => {
    expect(shouldEndSession({ valid: true })).toBe(false)
  })

  it("keeps the session when the field is missing", () => {
    // The route answers `valid: true` for network failures and GitHub 5xx, so
    // a body without the field is a shape nobody designed — an error payload, a
    // proxy page, a rename. None of those prove anything about the token.
    expect(shouldEndSession({})).toBe(false)
    expect(shouldEndSession({ error: "Internal Server Error" })).toBe(false)
  })

  it("keeps the session for anything that is not an object", () => {
    expect(shouldEndSession(null)).toBe(false)
    expect(shouldEndSession(undefined)).toBe(false)
    expect(shouldEndSession("valid: false")).toBe(false)
    expect(shouldEndSession(0)).toBe(false)
  })

  it("does not treat a falsy non-false value as proof", () => {
    // `!data.valid` would sign the user out for every one of these.
    expect(shouldEndSession({ valid: undefined })).toBe(false)
    expect(shouldEndSession({ valid: null })).toBe(false)
    expect(shouldEndSession({ valid: 0 })).toBe(false)
    expect(shouldEndSession({ valid: "" })).toBe(false)
  })
})
