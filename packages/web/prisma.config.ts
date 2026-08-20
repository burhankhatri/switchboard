import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "prisma/config"
import { loadEnvFiles } from "./lib/load-env-files"

const configDir = path.dirname(fileURLToPath(import.meta.url))
// .env.local overrides .env, but neither overrides a variable already set in
// the environment. Loading these with dotenv's `override: true` would clobber
// an explicit DATABASE_URL — which is how `prisma migrate reset --force` in
// e2e/global-setup.ts ended up resolving to production Neon despite being
// handed a localhost URL. See lib/load-env-files.ts.
loadEnvFiles(configDir)

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prefer the direct (non-pooling) connection for CLI/migrations — the
    // pgbouncer pooler can't take the advisory locks migrate needs. The runtime
    // app is unaffected (it connects via DATABASE_URL through its own client).
    // Migrations run over a direct/session connection (DIRECT_URL); fall back to
    // DATABASE_URL for local/legacy setups that don't define one.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
})
