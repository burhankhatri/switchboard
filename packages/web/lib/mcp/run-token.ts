import { createHmac, timingSafeEqual } from "crypto"

/**
 * The bearer token a sandbox uses to call back into this app.
 *
 * A run happens inside a sandbox started with `--dangerously-skip-permissions`,
 * reading text an attacker can influence. So this token says who the run is for
 * and which workspace it belongs to, and nothing else — it is not a session.
 * Every capability it unlocks is re-authorised server-side against these
 * claims, and membership is re-checked on each call rather than trusted from
 * the token, because a run outlives the membership that started it.
 *
 * Signed rather than stored: a run is short-lived and serverless has nowhere
 * convenient to keep state, so the expiry does the work a revocation list
 * otherwise would. Keep TTLs close to the run's hard timeout.
 */

/**
 * How long a run token stays valid. Comfortably longer than the scheduled hard
 * timeout so a long run can still call out at the end, short enough that a
 * leaked token is not a standing key.
 */
export const RUN_TOKEN_TTL_MS = 6 * 60 * 60 * 1000

export interface RunTokenClaims {
  /** Who the run is attributed to. Every action is taken as this user. */
  userId: string
  /** The workspace the run is bound to, if any. */
  workspaceId: string | null
  /** The chat this run belongs to, for attribution and rate limiting. */
  chatId: string | null
  /** Expiry, epoch ms. */
  exp: number
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (!value) {
    // Refused rather than defaulted: an empty key would produce tokens anyone
    // could forge, and the failure would be silent.
    throw new Error("NEXTAUTH_SECRET is required to sign run tokens")
  }
  return value
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest())
}

/** Mint a token for one run. */
export function mintRunToken(
  claims: Omit<RunTokenClaims, "exp">,
  now = Date.now()
): string {
  const payload = b64url(
    JSON.stringify({ ...claims, exp: now + RUN_TOKEN_TTL_MS } satisfies RunTokenClaims)
  )
  return `${payload}.${sign(payload)}`
}

/**
 * Verify a token and return its claims, or null.
 *
 * Null for every failure mode — bad shape, bad signature, expired. The caller
 * answers 401 without saying which, because the difference is only useful to
 * someone probing it.
 */
export function verifyRunToken(token: string | null | undefined, now = Date.now()): RunTokenClaims | null {
  if (!token) return null
  const dot = token.indexOf(".")
  if (dot <= 0 || dot === token.length - 1) return null

  const payload = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  const expected = sign(payload)

  // Constant-time: a length-varying or short-circuiting compare leaks the
  // signature one byte at a time to anyone who can time the endpoint.
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let claims: RunTokenClaims
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }

  if (typeof claims?.userId !== "string" || !claims.userId) return null
  if (typeof claims?.exp !== "number" || claims.exp <= now) return null

  return {
    userId: claims.userId,
    workspaceId: typeof claims.workspaceId === "string" ? claims.workspaceId : null,
    chatId: typeof claims.chatId === "string" ? claims.chatId : null,
    exp: claims.exp,
  }
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}
