/**
 * Playwright Global Setup
 *
 * Runs before all tests:
 * 1. Validates we're using a test database (safety check)
 * 2. Resets the database and runs migrations
 */

import { execSync } from "child_process"
import path from "path"

export default async function globalSetup() {
  // Env is already loaded by playwright.config.ts before this runs.
  const dbUrl = process.env.DATABASE_URL || ""

  // Safety check: refuse to run on production database
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL is not set. Create a .env.test file with a TEST database URL."
    )
  }

  // Check that this looks like a local database
  // Can be bypassed with I_KNOW_THIS_IS_THE_TEST_DB=true
  const isTestDb =
    process.env.I_KNOW_THIS_IS_THE_TEST_DB === "true" ||
    dbUrl.includes("localhost") ||
    dbUrl.includes("127.0.0.1")

  if (!isTestDb) {
    throw new Error(
      `\nRefusing to wipe a non-local database.\n\n` +
        `Every E2E test run resets the database with \`prisma migrate reset --force\`,\n` +
        `which drops every table. To guard against accidentally targeting a real DB,\n` +
        `the DATABASE_URL must contain "localhost" or "127.0.0.1".\n\n` +
        `Current DATABASE_URL: ${dbUrl.replace(/:[^:@]+@/, ":****@")}\n\n` +
        `Fix one of:\n` +
        `  - Point DATABASE_URL at a local test DB (set it in packages/web/.env.test).\n` +
        `  - Set I_KNOW_THIS_IS_THE_TEST_DB=true if you genuinely want to wipe this one.\n`
    )
  }

  // Belt and braces. The check above reads process.env; what actually gets
  // reset is whatever prisma.config.ts resolves, and those were not always the
  // same value — .env.local used to override an explicit DATABASE_URL, so this
  // localhost check passed while `migrate reset` targeted production Neon.
  // lib/load-env-files.ts fixes that, but ask Prisma directly rather than
  // trusting it: this is the last gate before dropping every table.
  const resolved = execSync("npx prisma migrate status", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const datasource = resolved.match(/Datasource .*/)?.[0] ?? "(not reported)"
  if (!/localhost|127\.0\.0\.1/.test(datasource)) {
    throw new Error(
      `\nRefusing to reset: Prisma resolved a non-local database.\n\n` +
        `  ${datasource}\n\n` +
        `DATABASE_URL was set to a localhost URL, so something downstream is\n` +
        `overriding it — check packages/web/prisma.config.ts and .env.local.\n`
    )
  }

  console.log("🧪 Setting up test database...")

  try {
    // Reset database (this drops all tables and re-runs migrations)
    // The PRISMA_USER_CONSENT variable bypasses AI safety checks since this is intentional test setup
    execSync("npx prisma migrate reset --force", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
      },
    })

    console.log("✅ Test database ready")
  } catch (error) {
    console.error("❌ Failed to setup test database:", error)
    throw error
  }
}
