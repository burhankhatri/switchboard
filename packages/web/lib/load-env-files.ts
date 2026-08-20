import { config as loadEnv } from "dotenv"
import path from "node:path"

/**
 * Load .env then .env.local, without ever clobbering a variable the caller set.
 *
 * dotenv's `override: true` overrides **process.env**, not just the previously
 * loaded file. That is almost never what you want for a database URL: it means
 *
 *     DATABASE_URL=postgres://localhost/test npx prisma migrate reset --force
 *
 * silently resets whatever .env.local points at instead — which for this repo
 * is the production Neon database. e2e/global-setup.ts does exactly that, and
 * its localhost safety check passes because it inspects process.env, the value
 * Prisma then discards.
 *
 * So: .env.local still overrides .env, and neither overrides an explicit
 * environment variable. This matches how Next.js treats real env vars, and how
 * every CLI that reads a dotfile is expected to behave.
 */
export function loadEnvFiles(dir: string): void {
  // Snapshot before touching anything. Only keys present here were set by the
  // caller (or inherited from the shell), and those must survive.
  const explicit = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) explicit.set(key, value)
  }

  loadEnv({ path: path.join(dir, ".env") })
  loadEnv({ path: path.join(dir, ".env.local"), override: true })

  for (const [key, value] of explicit) {
    process.env[key] = value
  }
}
