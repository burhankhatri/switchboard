import { Client } from "pg"
import { parse } from "dotenv"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const env = parse(await readFile(path.join(root, ".env.test")))
const url = new URL(env.DATABASE_URL)
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("This check requires local Postgres")
const name = `home_ai_check_${Date.now()}`
const admin = new Client({ connectionString: url.href })
await admin.connect()
await admin.query(`CREATE DATABASE "${name}"`)
url.pathname = `/${name}`
const childEnv = { ...process.env, ...env, DATABASE_URL: url.href, DIRECT_URL: url.href, HOME_AI_ENABLED: "false" }
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: "inherit" })
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Check exited ${code}`)))
})
try {
  await run([path.join(root, "../../node_modules/prisma/build/index.js"), "migrate", "deploy"])
  await run(["--import", "tsx", "e2e/fixtures/check-home-ai-db.ts"])
} finally {
  // Only the uniquely named database this process just created is removed.
  if (!/^home_ai_check_\d+$/.test(name)) throw new Error("Unexpected scratch database name")
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
  await admin.end()
}
