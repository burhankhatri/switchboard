import { Daytona } from "@daytonaio/sdk"

/**
 * One Daytona client per process.
 *
 * Seventeen route handlers each did `new Daytona({ apiKey })` per request. The
 * client holds connection state, so constructing one per request threw that
 * away every time — most visibly on the `list-servers` poll, which runs on a
 * timer and rebuilt a client on every tick.
 *
 * The key comes from the environment and cannot change without a restart, so a
 * module-level instance is safe. Kept as a function rather than a top-level
 * `new` so that importing this module does not throw in environments where the
 * key is absent (tests, build-time analysis).
 */
let client: Daytona | null = null

/**
 * Returns the shared client, or null when DAYTONA_API_KEY is unset so callers
 * can return their own "not configured" response.
 */
export function getDaytona(): Daytona | null {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return null
  if (!client) client = new Daytona({ apiKey })
  return client
}
