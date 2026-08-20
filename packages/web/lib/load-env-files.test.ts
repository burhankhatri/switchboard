import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadEnvFiles } from "./load-env-files"

/**
 * This exists because getting it wrong wipes the production database.
 *
 * prisma.config.ts loads these files to resolve the migration datasource, and
 * e2e/global-setup.ts runs `prisma migrate reset --force` after setting
 * DATABASE_URL to a local test database. If a dotfile can override that, the
 * reset lands on whatever .env.local points at.
 */
let dir: string
const saved = { ...process.env }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "envfiles-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key]
  }
  Object.assign(process.env, saved)
})

const write = (name: string, body: string) =>
  fs.writeFileSync(path.join(dir, name), body)

describe("loadEnvFiles", () => {
  it("does not let .env.local override an explicitly set variable", () => {
    write(".env.local", "DATABASE_URL=postgresql://neon.tech/production")
    process.env.DATABASE_URL = "postgresql://localhost:5432/switchboard_test"

    loadEnvFiles(dir)

    expect(process.env.DATABASE_URL).toBe(
      "postgresql://localhost:5432/switchboard_test"
    )
  })

  it("does not let .env override an explicitly set variable either", () => {
    write(".env", "DIRECT_URL=postgresql://neon.tech/production")
    process.env.DIRECT_URL = "postgresql://localhost:5432/switchboard_test"

    loadEnvFiles(dir)

    expect(process.env.DIRECT_URL).toBe(
      "postgresql://localhost:5432/switchboard_test"
    )
  })

  it("still lets .env.local win over .env", () => {
    write(".env", "SOME_KEY=from-env")
    write(".env.local", "SOME_KEY=from-env-local")
    delete process.env.SOME_KEY

    loadEnvFiles(dir)

    expect(process.env.SOME_KEY).toBe("from-env-local")
  })

  it("fills in a variable that is absent from the environment", () => {
    write(".env", "ONLY_IN_FILE=hello")
    delete process.env.ONLY_IN_FILE

    loadEnvFiles(dir)

    expect(process.env.ONLY_IN_FILE).toBe("hello")
  })

  it("is fine when neither file exists", () => {
    expect(() => loadEnvFiles(dir)).not.toThrow()
  })
})
