import { describe, it, expect, beforeAll } from "vitest"
import {
  mintRunToken,
  verifyRunToken,
  bearerFrom,
  RUN_TOKEN_TTL_MS,
} from "./run-token"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-run-tokens"
})

const claims = { userId: "u1", workspaceId: "w1", chatId: "c1" }

describe("run tokens", () => {
  it("round-trips the claims a run is scoped to", () => {
    const parsed = verifyRunToken(mintRunToken(claims))
    expect(parsed).toMatchObject(claims)
  })

  it("carries a null workspace for a run outside one", () => {
    const parsed = verifyRunToken(mintRunToken({ userId: "u1", workspaceId: null, chatId: null }))
    expect(parsed).toMatchObject({ userId: "u1", workspaceId: null, chatId: null })
  })

  it("rejects a tampered payload", () => {
    // The whole point: a sandbox holds this token and can read it. Editing the
    // workspace id in it must not grant another workspace's schedule.
    const token = mintRunToken(claims)
    const [payload, sig] = token.split(".")
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    decoded.workspaceId = "someone-elses-workspace"
    const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url")
    expect(verifyRunToken(`${forged}.${sig}`)).toBeNull()
  })

  it("rejects a token signed with a different secret", () => {
    const token = mintRunToken(claims)
    const original = process.env.NEXTAUTH_SECRET
    process.env.NEXTAUTH_SECRET = "a-different-secret"
    expect(verifyRunToken(token)).toBeNull()
    process.env.NEXTAUTH_SECRET = original
  })

  it("rejects an expired token", () => {
    const now = Date.now()
    const token = mintRunToken(claims, now)
    expect(verifyRunToken(token, now + RUN_TOKEN_TTL_MS - 1000)).not.toBeNull()
    expect(verifyRunToken(token, now + RUN_TOKEN_TTL_MS + 1000)).toBeNull()
  })

  it("rejects malformed input rather than throwing", () => {
    for (const bad of [null, undefined, "", "no-dot", ".", "abc.", ".abc", "a.b.c"]) {
      expect(verifyRunToken(bad as string | null)).toBeNull()
    }
  })

  it("reads a bearer header, and only a bearer header", () => {
    expect(bearerFrom("Bearer abc.def")).toBe("abc.def")
    expect(bearerFrom("bearer abc.def")).toBe("abc.def")
    expect(bearerFrom("Basic abc.def")).toBeNull()
    expect(bearerFrom(null)).toBeNull()
  })
})
