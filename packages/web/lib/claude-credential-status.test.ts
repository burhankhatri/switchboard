import { describe, it, expect } from "vitest"
import {
  checkPoolCredentials,
  claudeCredentialStatus,
  describeClaudeCredential,
} from "./claude-credential-status"

const NOW = 1_787_000_000_000
const blob = (oauth: Record<string, unknown>) => JSON.stringify({ claudeAiOauth: oauth })

describe("claudeCredentialStatus", () => {
  it("reports a missing credential", () => {
    expect(claudeCredentialStatus(null, NOW).status).toBe("missing")
    expect(claudeCredentialStatus("   ", NOW).status).toBe("missing")
  })

  it("reports a valid credential with its remaining life", () => {
    const s = claudeCredentialStatus(
      blob({ accessToken: "a", refreshToken: "r", expiresAt: NOW + 3 * 3_600_000 }),
      NOW
    )
    expect(s.status).toBe("valid")
    if (s.status === "valid") expect(Math.round(s.expiresInMs / 3_600_000)).toBe(3)
  })

  it("reports expiry, which is the case that used to fail silently", () => {
    // The real one from the report: pasted 17h after it had already expired.
    const s = claudeCredentialStatus(
      blob({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: NOW - 17 * 3_600_000,
        refreshTokenExpiresAt: NOW + 7 * 86_400_000,
      }),
      NOW
    )
    expect(s.status).toBe("expired")
    if (s.status === "expired") expect(s.refreshUsable).toBe(true)
  })

  it("distinguishes a dead refresh token, which needs a fresh sign-in", () => {
    const s = claudeCredentialStatus(
      blob({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: NOW - 3_600_000,
        refreshTokenExpiresAt: NOW - 1_000,
      }),
      NOW
    )
    expect(s.status).toBe("expired")
    if (s.status === "expired") expect(s.refreshUsable).toBe(false)
  })

  it("treats a token expiring within the margin as expired", () => {
    // Otherwise a run started now would fail mid-turn instead of up front.
    expect(claudeCredentialStatus(blob({ accessToken: "a", expiresAt: NOW + 30_000 }), NOW).status).toBe("expired")
  })

  it("names what is wrong with a malformed blob", () => {
    expect(claudeCredentialStatus("not json", NOW)).toMatchObject({ status: "unparseable" })
    expect(claudeCredentialStatus(JSON.stringify({ nope: 1 }), NOW)).toMatchObject({ status: "unparseable" })
    const s = claudeCredentialStatus(blob({ accessToken: "a" }), NOW)
    expect(s.status).toBe("unparseable")
    if (s.status === "unparseable") expect(s.reason).toMatch(/expiresAt/)
  })

  it("accepts the real shape, including unrelated sibling keys", () => {
    // A pasted credentials.json also carries mcpOAuth; it must not confuse this.
    const raw = JSON.stringify({
      mcpOAuth: { something: { serverName: "x" } },
      claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: NOW + 8 * 3_600_000 },
    })
    expect(claudeCredentialStatus(raw, NOW).status).toBe("valid")
  })

  it("advises differently depending on whether the refresh token survives", () => {
    const live = claudeCredentialStatus(blob({ accessToken: "a", refreshToken: "r", expiresAt: NOW - 3_600_000, refreshTokenExpiresAt: NOW + 86_400_000 }), NOW)
    const dead = claudeCredentialStatus(blob({ accessToken: "a", refreshToken: "r", expiresAt: NOW - 3_600_000, refreshTokenExpiresAt: NOW - 10 }), NOW)
    expect(describeClaudeCredential(live)).toMatch(/re-copying/i)
    expect(describeClaudeCredential(dead)).toMatch(/sign in to claude code again/i)
  })
})

describe("checkPoolCredentials", () => {
  const good = { accessToken: "a", refreshToken: "r", expiresAt: NOW + 3_600_000 }

  it("stores a valid blob on a single line, every field intact", () => {
    const pasted = JSON.stringify(
      { claudeAiOauth: { ...good, scopes: ["user:inference"], subscriptionType: "pro" } },
      null,
      2
    )
    const c = checkPoolCredentials(pasted, NOW)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.value).not.toContain("\n")
    expect(JSON.parse(c.value)).toEqual(JSON.parse(pasted))
    expect(c.expiresAt).toBe(good.expiresAt)
  })

  it("rejects what the refresh cron would not recognise", () => {
    // Without expiresAt the cron reads the row as malformed and overwrites it.
    const { expiresAt: _e, ...noExpiry } = good
    const { refreshToken: _r, ...noRefresh } = good
    expect(checkPoolCredentials("not json", NOW).ok).toBe(false)
    expect(checkPoolCredentials(blob(noExpiry), NOW).ok).toBe(false)
    expect(checkPoolCredentials(blob(noRefresh), NOW).ok).toBe(false)
  })

  it("accepts an expired access token only while its refresh token still works", () => {
    const expired = { ...good, expiresAt: NOW - 3_600_000 }
    expect(
      checkPoolCredentials(blob({ ...expired, refreshTokenExpiresAt: NOW + 86_400_000 }), NOW).ok
    ).toBe(true)
    expect(
      checkPoolCredentials(blob({ ...expired, refreshTokenExpiresAt: NOW - 1 }), NOW).ok
    ).toBe(false)
  })
})
