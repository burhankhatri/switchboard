import { test, expect } from "@playwright/test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import pg from "pg"

/**
 * The one-time reset that makes OpenCode on GLM-5.2 everyone's default. @no-sandbox
 *
 * Runs against the E2E Postgres (global-setup has already applied every
 * migration to an empty database), so it seeds rows the way production had
 * them, replays the migration's SQL inside a transaction, checks the result,
 * and rolls back.
 */
const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations")

function migrationSql(): string {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith("_default_opencode_glm52"))
  if (!dir) throw new Error("migration *_default_opencode_glm52 not found")
  return readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8")
}

test.describe("default harness migration @no-sandbox", () => {
  test("moves every user and workspace to OpenCode on GLM-5.2, keeping other settings", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO "User" (id, email, settings, "createdAt", "updatedAt") VALUES
           ('mig_u1', 'mig1@playwright.local', '{"defaultAgent":"opencode","defaultModel":"opencode/big-pickle","theme":"dark"}', now(), now()),
           ('mig_u2', 'mig2@playwright.local', '{"defaultAgent":"claude-code","defaultModel":"default"}', now(), now()),
           ('mig_u3', 'mig3@playwright.local', NULL, now(), now())`
      )
      await client.query(
        `INSERT INTO "Workspace" (id, slug, name, repo, path, agent, model, "createdById", "updatedAt") VALUES
           ('mig_w1', 'mig-ws', 'Mig WS', 'o/r', 'workspaces/mig-ws', 'claude', NULL, 'mig_u1', now())`
      )

      await client.query(migrationSql())

      const users = await client.query(
        `SELECT id, settings FROM "User" WHERE id LIKE 'mig_u%' ORDER BY id`
      )
      for (const u of users.rows) {
        expect(u.settings.defaultAgent).toBe("opencode")
        expect(u.settings.defaultModel).toBe("opencode-go/glm-5.2")
      }
      expect(users.rows[0].settings.theme).toBe("dark")

      const ws = await client.query(`SELECT agent, model FROM "Workspace" WHERE id = 'mig_w1'`)
      expect(ws.rows[0]).toEqual({ agent: "opencode", model: "opencode-go/glm-5.2" })

      // New workspaces default to OpenCode at the column level too.
      const def = await client.query(
        `SELECT column_default FROM information_schema.columns
          WHERE table_name = 'Workspace' AND column_name = 'agent'`
      )
      expect(def.rows[0].column_default).toContain("opencode")
    } finally {
      await client.query("ROLLBACK").catch(() => {})
      await client.end()
    }
  })
})
