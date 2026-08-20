import { describe, it, expect } from "vitest"
import { shouldBlockForAuthFailure } from "./credential-health"

const at = (iso: string) => new Date(iso)

describe("shouldBlockForAuthFailure", () => {
  it("does not block when the provider has never rejected the credential", () => {
    expect(
      shouldBlockForAuthFailure({
        lastAuthFailureAt: null,
        credentialsUpdatedAt: at("2026-08-20T10:00:00Z"),
      })
    ).toBe(false)
  })

  it("blocks when the rejection is newer than the stored credential", () => {
    // The key was already rejected and nothing has changed since, so building a
    // sandbox would only reproduce the same 401 two minutes later.
    expect(
      shouldBlockForAuthFailure({
        lastAuthFailureAt: at("2026-08-20T12:00:00Z"),
        credentialsUpdatedAt: at("2026-08-20T10:00:00Z"),
      })
    ).toBe(true)
  })

  it("stops blocking once the user has updated their credentials", () => {
    // The important direction. Someone who has just pasted a working key must
    // get a run — otherwise a stale marker strands them with no way to prove it
    // is fixed, which is far worse than one wasted sandbox.
    expect(
      shouldBlockForAuthFailure({
        lastAuthFailureAt: at("2026-08-20T10:00:00Z"),
        credentialsUpdatedAt: at("2026-08-20T12:00:00Z"),
      })
    ).toBe(false)
  })

  it("blocks when the credential write time is unknown", () => {
    expect(
      shouldBlockForAuthFailure({
        lastAuthFailureAt: at("2026-08-20T10:00:00Z"),
        credentialsUpdatedAt: null,
      })
    ).toBe(true)
  })

  it("treats an exactly-simultaneous update as a retry", () => {
    // Equal timestamps mean we cannot tell the order, so let the run through.
    // Failing open costs a sandbox; failing closed locks someone out.
    const t = at("2026-08-20T10:00:00Z")
    expect(
      shouldBlockForAuthFailure({ lastAuthFailureAt: t, credentialsUpdatedAt: t })
    ).toBe(false)
  })
})
