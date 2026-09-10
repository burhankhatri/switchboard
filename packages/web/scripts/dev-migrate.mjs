import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadEnv } from "dotenv"

/**
 * Apply pending migrations before the dev server starts.
 *
 * Pulling a branch that adds a migration used to leave you with a schema the
 * code no longer matches, and the symptom is a runtime Prisma error deep in a
 * request rather than anything pointing at migrations. `prebuild` already does
 * this for builds and deploys; this is the same guarantee for `npm run dev`.
 *
 * Non-fatal by design. Working offline, or on a laptop that cannot reach Neon,
 * must still start a dev server — the failure is printed loudly and the server
 * comes up anyway.
 */

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// Same precedence as prisma.config.ts and lib/load-env-files.ts: .env.local
// beats .env, and neither beats a variable already in the environment. That
// last part matters — dotenv's `override` overrides process.env, so without
// restoring the snapshot an explicit `DATABASE_URL=... npm run dev` would
// migrate whatever .env.local points at instead.
const explicit = new Map(Object.entries(process.env))
loadEnv({ path: path.join(webDir, ".env") })
loadEnv({ path: path.join(webDir, ".env.local"), override: true })
for (const [key, value] of explicit) process.env[key] = value

const url = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  console.log("[dev-migrate] no DATABASE_URL — skipping migrations")
  process.exit(0)
}

// The pgbouncer pooler cannot take the session-level advisory lock migrate
// needs; against it this hangs rather than failing, which reads as a frozen
// dev server. Refuse instead of waiting.
if (url.includes(":6543") || url.includes("pgbouncer=true")) {
  console.warn(
    "[dev-migrate] DIRECT_URL/DATABASE_URL points at the transaction pooler — " +
      "skipping. Set DIRECT_URL to the direct (port 5432) connection."
  )
  process.exit(0)
}

// execSync, not execFileSync: on Windows `npx` is a .cmd shim, which Node
// refuses to spawn directly (EINVAL) unless it goes through a shell. Same
// reason scripts/prisma-deploy.mjs uses it.
const run = (cmd, stdio) => execSync(cmd, { cwd: webDir, stdio, encoding: "utf8" })

try {
  // `migrate status` exits non-zero when anything is pending, so the check and
  // the decision are the same call.
  let pending = false
  try {
    run("npx prisma migrate status", "pipe")
  } catch {
    pending = true
  }

  if (!pending) {
    console.log("[dev-migrate] database is up to date")
    process.exit(0)
  }

  console.log("[dev-migrate] applying pending migrations…")
  run("npx prisma migrate deploy", "inherit")
  // The client is generated from the schema, not the database, but a migration
  // arriving from someone else's branch means the schema moved too.
  run("npx prisma generate", "inherit")
} catch (err) {
  console.warn(
    "\n[dev-migrate] could not apply migrations — starting the dev server anyway.\n" +
      "  Run `npx prisma migrate deploy` once you can reach the database.\n" +
      `  ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n`
  )
}
