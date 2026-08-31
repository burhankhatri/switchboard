import { describe, it, expect } from "vitest"
import {
  shouldRefreshGitHubToken,
  parseRefreshResponse,
  REFRESH_MARGIN_MS,
  tokenAfterRefresh,
} from "./github-token-refresh"

const NOW = Date.UTC(2026, 7, 20, 18, 0, 0)
const secs = (ms: number) => Math.floor(ms / 1000)

describe("shouldRefreshGitHubToken", () => {
  it("refreshes a token that has already expired", () => {
    // The live case: both stored tokens were two days past expiry, still being
    // handed to the file tree and the sandbox clone.
    expect(
      shouldRefreshGitHubToken(
        { expiresAt: secs(NOW) - 3600, hasRefreshToken: true },
        NOW
      )
    ).toBe(true)
  })

  it("refreshes just before expiry rather than at it", () => {
    // A token that dies mid-request fails a clone halfway through.
    expect(
      shouldRefreshGitHubToken(
        { expiresAt: secs(NOW + REFRESH_MARGIN_MS / 2), hasRefreshToken: true },
        NOW
      )
    ).toBe(true)
  })

  it("leaves a healthy token alone", () => {
    expect(
      shouldRefreshGitHubToken({ expiresAt: secs(NOW) + 7200, hasRefreshToken: true }, NOW)
    ).toBe(false)
  })

  it("does nothing without a refresh token", () => {
    expect(
      shouldRefreshGitHubToken({ expiresAt: secs(NOW) - 3600, hasRefreshToken: false }, NOW)
    ).toBe(false)
  })

  it("treats an unknown expiry as valid", () => {
    // Some app configurations issue non-expiring tokens and record no expiry.
    // Refreshing those every request would burn the refresh token for nothing.
    expect(
      shouldRefreshGitHubToken({ expiresAt: null, hasRefreshToken: true }, NOW)
    ).toBe(false)
  })
})

describe("parseRefreshResponse", () => {
  it("reads a successful refresh", () => {
    const out = parseRefreshResponse({
      access_token: "gho_new",
      refresh_token: "ghr_new",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    })
    expect(out).toMatchObject({ accessToken: "gho_new", refreshToken: "ghr_new" })
    expect("error" in out).toBe(false)
  })

  it("treats an error body as a failure even though GitHub sends it with 200", () => {
    // The trap: this endpoint answers 200 with an `error` field, so checking
    // res.ok would store `undefined` as the access token and lock the user out
    // more thoroughly than the expiry did.
    const out = parseRefreshResponse({
      error: "bad_refresh_token",
      error_description: "The refresh token passed is incorrect or expired.",
    })
    expect(out).toEqual({ error: "The refresh token passed is incorrect or expired." })
  })

  it("rejects a body with no access token", () => {
    expect(parseRefreshResponse({ token_type: "bearer" })).toHaveProperty("error")
    expect(parseRefreshResponse(null)).toHaveProperty("error")
  })

  it("survives a response that omits expiry", () => {
    const out = parseRefreshResponse({ access_token: "gho_new" })
    expect(out).toMatchObject({ accessToken: "gho_new", expiresAt: null })
  })
})

describe("tokenAfterRefresh", () => {
  it("uses the refreshed token when the refresh worked", () => {
    expect(tokenAfterRefresh("gho_new", "gho_old")).toBe("gho_new")
  })

  it("keeps the stored token when the refresh failed", () => {
    // The regression this exists to prevent. Returning null here surfaced as
    // "GitHub account not linked": a permanent re-authorize banner, no repo
    // access, and no sandbox creation — while the stored token was still
    // answering GitHub with 200.
    expect(tokenAfterRefresh(null, "gho_old")).toBe("gho_old")
  })

  it("returns null only when there is genuinely nothing to use", () => {
    expect(tokenAfterRefresh(null, null)).toBeNull()
  })
})
