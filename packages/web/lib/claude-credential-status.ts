/**
 * The state of a stored Claude Code credential blob.
 *
 * A subscription token lasts about eight hours. Nothing refreshes a *user's own*
 * stored credential — the refresh cron and admin endpoint both operate on the
 * shared-pool row — so a pasted blob works for the rest of its life and then
 * stops, with the failure surfacing as an opaque agent error a day later.
 *
 * Deliberately pure and dependency-free so it can run on the request path and
 * in the browser, and be tested without a database or a sandbox.
 */

/** Treat a token expiring within this window as already expired. */
const EXPIRY_MARGIN_MS = 60_000

export type ClaudeCredentialState =
  | { status: "missing" }
  | { status: "unparseable"; reason: string }
  | { status: "expired"; expiredAt: number; refreshUsable: boolean }
  | { status: "valid"; expiresAt: number; expiresInMs: number }

interface ClaudeBlob {
  claudeAiOauth?: {
    accessToken?: unknown
    refreshToken?: unknown
    expiresAt?: unknown
    refreshTokenExpiresAt?: unknown
  }
}

export function claudeCredentialStatus(
  raw: string | null | undefined,
  now: number = Date.now()
): ClaudeCredentialState {
  if (!raw || !raw.trim()) return { status: "missing" }

  let parsed: ClaudeBlob
  try {
    parsed = JSON.parse(raw) as ClaudeBlob
  } catch {
    return { status: "unparseable", reason: "not valid JSON" }
  }

  const oauth = parsed?.claudeAiOauth
  if (!oauth || typeof oauth !== "object") {
    return { status: "unparseable", reason: "missing a claudeAiOauth object" }
  }
  if (typeof oauth.accessToken !== "string" || !oauth.accessToken) {
    return { status: "unparseable", reason: "missing claudeAiOauth.accessToken" }
  }
  if (typeof oauth.expiresAt !== "number") {
    return { status: "unparseable", reason: "missing claudeAiOauth.expiresAt" }
  }

  const expiresAt = oauth.expiresAt
  if (expiresAt - EXPIRY_MARGIN_MS <= now) {
    // The refresh token outlives the access token by about a week. Whether it
    // is still good decides which advice to give: re-authenticate, or just
    // refresh.
    const refreshExpiresAt =
      typeof oauth.refreshTokenExpiresAt === "number" ? oauth.refreshTokenExpiresAt : null
    const refreshUsable =
      typeof oauth.refreshToken === "string" &&
      !!oauth.refreshToken &&
      (refreshExpiresAt === null || refreshExpiresAt > now)
    return { status: "expired", expiredAt: expiresAt, refreshUsable }
  }

  return { status: "valid", expiresAt, expiresInMs: expiresAt - now }
}

/** Short human phrasing for the UI and for error messages. */
export function describeClaudeCredential(state: ClaudeCredentialState): string {
  switch (state.status) {
    case "missing":
      return "No Claude Code credential stored."
    case "unparseable":
      return `That does not look like a credentials.json — ${state.reason}.`
    case "expired": {
      const hours = Math.max(1, Math.round((Date.now() - state.expiredAt) / 3_600_000))
      return state.refreshUsable
        ? `Expired ${hours}h ago. Its refresh token is still valid, so re-copying credentials.json from your machine will fix it.`
        : `Expired ${hours}h ago, and its refresh token has expired too. Sign in to Claude Code again and copy the new credentials.json.`
    }
    case "valid": {
      const hours = Math.floor(state.expiresInMs / 3_600_000)
      const mins = Math.round((state.expiresInMs % 3_600_000) / 60_000)
      return hours > 0 ? `Valid for ${hours}h ${mins}m.` : `Valid for ${mins}m.`
    }
  }
}
