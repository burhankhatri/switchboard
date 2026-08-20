/**
 * Keeping a GitHub user token alive.
 *
 * GitHub App user tokens expire after about eight hours. Nothing refreshed
 * them, so once the clock ran out the stored token stayed in the database and
 * kept being handed to every caller: the file tree 401'd ("Could not load
 * files."), the repo picker 401'd, and — the expensive one — the sandbox clone
 * failed, so agents stopped running until the user signed out and back in.
 *
 * The refresh token sits in the same row and is good for ~184 days, so this was
 * always recoverable without touching the user.
 */

/** Refresh a little early: a token that dies mid-request is the case to avoid. */
export const REFRESH_MARGIN_MS = 5 * 60_000

export interface TokenExpiry {
  /** Unix seconds, as GitHub and NextAuth store it. Null when unknown. */
  expiresAt: number | null
  hasRefreshToken: boolean
}

/**
 * Should this token be refreshed before use?
 *
 * An unknown expiry is treated as still valid. Some GitHub app configurations
 * issue non-expiring tokens and record nothing, and refreshing those on every
 * request would burn the refresh token for no reason.
 */
export function shouldRefreshGitHubToken(
  { expiresAt, hasRefreshToken }: TokenExpiry,
  now: number = Date.now()
): boolean {
  if (!hasRefreshToken) return false
  if (expiresAt === null) return false
  return expiresAt * 1000 - REFRESH_MARGIN_MS <= now
}

export interface RefreshedToken {
  accessToken: string
  refreshToken: string | null
  /** Unix seconds. */
  expiresAt: number | null
  refreshTokenExpiresIn: number | null
}

/**
 * Read GitHub's refresh response.
 *
 * The endpoint answers 200 with an `error` field on failure rather than an HTTP
 * error code, so a naive `res.ok` check treats a dead refresh token as success
 * and stores `undefined` as the access token.
 */
export function parseRefreshResponse(body: unknown): RefreshedToken | { error: string } {
  if (!body || typeof body !== "object") return { error: "empty response" }
  const b = body as Record<string, unknown>

  if (typeof b.error === "string") {
    return { error: typeof b.error_description === "string" ? b.error_description : b.error }
  }
  if (typeof b.access_token !== "string" || !b.access_token) {
    return { error: "no access_token in response" }
  }

  const expiresIn = typeof b.expires_in === "number" ? b.expires_in : null
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    expiresAt: expiresIn === null ? null : Math.floor(Date.now() / 1000) + expiresIn,
    refreshTokenExpiresIn:
      typeof b.refresh_token_expires_in === "number" ? b.refresh_token_expires_in : null,
  }
}
