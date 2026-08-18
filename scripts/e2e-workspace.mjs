/**
 * End-to-end test of the workspace use case against the running app.
 *
 * Mints a NextAuth JWT session cookie (strategy is "jwt", token.sub = user.id)
 * so the real HTTP routes are exercised, not the functions underneath them.
 *
 * Run from packages/web with the dev server up:
 *   GH_TOKEN=$(gh auth token) npx dotenv -e .env.local -- node ../../scripts/e2e-workspace.mjs
 *
 * It creates a real workspace and commits a real folder to the workspaces repo,
 * and creates + deletes a throwaway second user to exercise the membership rules.
 */
import { encode } from "next-auth/jwt"
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"

const BASE = "http://localhost:4000"
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) })

let pass = 0, fail = 0
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`)
  ok ? pass++ : fail++
  return ok
}

async function cookieFor(userId) {
  const token = await encode({ token: { sub: userId }, secret: process.env.NEXTAUTH_SECRET })
  return `next-auth.session-token=${token}`
}

const api = (cookie) => async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: res.status, body }
}

const user = await prisma.user.findFirst({ select: { id: true, name: true } })
if (!user) { console.error("no user in db — sign in first"); process.exit(1) }
console.log(`acting as: ${user.name} (${user.id})\n`)
const call = api(await cookieFor(user.id))

// Repeatable: drop the row from a previous run. The GitHub folder is left in
// place on purpose — recreating over it exercises putFile's never-clobber path.
await prisma.workspace.deleteMany({ where: { slug: "lead-gen" } })

// ── 1. baseline ───────────────────────────────────────────────────────────
console.log("1. list workspaces (baseline)")
let r = await call("/api/workspaces")
check("GET /api/workspaces authenticates", r.status === 200, `status ${r.status}`)
const before = r.body.workspaces?.length ?? -1
console.log(`     existing: ${before}`)

// ── 2. create ─────────────────────────────────────────────────────────────
console.log("\n2. create a workspace through the API")
const NAME = "Lead Gen"
r = await call("/api/workspaces", {
  method: "POST",
  body: JSON.stringify({
    name: NAME,
    systemPrompt: "You qualify commercial electricity leads for Live Energy in ERCOT.\nPrefer the scripts in ./scripts over writing new code.",
  }),
})
check("POST /api/workspaces returns 201", r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0,160)}`)
const ws = r.body.workspace
if (!ws) { console.error("no workspace returned; aborting"); process.exit(1) }
check("slug derived from name", ws.slug === "lead-gen", ws.slug)
check("path is workspaces/<slug>", ws.path === "workspaces/lead-gen", ws.path)
check("repo is the platform repo", ws.repo === process.env.WORKSPACES_REPO, ws.repo)

// ── 3. duplicate guard ────────────────────────────────────────────────────
console.log("\n3. duplicate name is rejected")
r = await call("/api/workspaces", { method: "POST", body: JSON.stringify({ name: NAME }) })
check("second create with same name → 400", r.status === 400, `status ${r.status}`)

// ── 4. it is mine, and listed ─────────────────────────────────────────────
console.log("\n4. list reflects membership")
r = await call("/api/workspaces")
const listed = r.body.workspaces.find((w) => w.id === ws.id)
check("appears in list", !!listed)
check("creator is joined", listed?.joined === true)
check("creator role is owner", listed?.role === "owner", String(listed?.role))
check("memberCount is 1", listed?.memberCount === 1, String(listed?.memberCount))

// ── 5. GitHub side ────────────────────────────────────────────────────────
console.log("\n5. folder committed to the private repo")
const gh = (p) => fetch(`https://api.github.com/repos/${process.env.WORKSPACES_REPO}/contents/${p}`, {
  headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
}).then((x) => x.status)
check("workspace.yaml exists", (await gh(`${ws.path}/workspace.yaml`)) === 200)
check("starter SKILL.md exists", (await gh(`${ws.path}/.claude/skills/lead-gen-guide/SKILL.md`)) === 200)

// ── 6. chat inherits workspace config ─────────────────────────────────────
console.log("\n6. starting a chat in the workspace")
r = await call("/api/chats", { method: "POST", body: JSON.stringify({ workspaceId: ws.id }) })
check("POST /api/chats succeeds without a repo", r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0,140)}`)
const chatId = r.body?.id
if (chatId) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { workspaceId: true, repo: true, baseBranch: true, agent: true, userId: true } })
  check("chat linked to workspace", chat?.workspaceId === ws.id)
  check("repo denormalized from workspace", chat?.repo === ws.repo, String(chat?.repo))
  check("baseBranch denormalized", chat?.baseBranch === "main", String(chat?.baseBranch))
  check("attribution preserved (chat.userId)", chat?.userId === user.id)
}

// ── 7. membership: join / last-owner guard ────────────────────────────────
console.log("\n7. membership rules")
const other = await prisma.user.create({ data: { name: "Test Colleague" } })
const call2 = api(await cookieFor(other.id))
r = await call2(`/api/workspaces/${ws.id}/membership`, { method: "POST" })
check("a second user can join", r.status === 200 && r.body.joined === true, `status ${r.status}`)
r = await call2("/api/workspaces")
check("workspace now shows 2 members", r.body.workspaces.find((w) => w.id === ws.id)?.memberCount === 2)
r = await call2(`/api/workspaces/${ws.id}/membership`, { method: "POST" })
check("joining twice is idempotent", r.status === 200, `status ${r.status}`)
r = await call(`/api/workspaces/${ws.id}/membership`, { method: "DELETE" })
check("last owner cannot leave", r.status === 400, `status ${r.status} ${JSON.stringify(r.body).slice(0,90)}`)
r = await call2(`/api/workspaces/${ws.id}/membership`, { method: "DELETE" })
check("a member can leave", r.status === 200 && r.body.joined === false, `status ${r.status}`)

// ── 9. workspace connections (env) ────────────────────────────────────────
console.log("\n9. workspace connections")
r = await call(`/api/workspaces/${ws.id}/env`)
check("GET env returns no keys initially", r.status === 200 && r.body.keys.length === 0, `status ${r.status}`)

r = await call(`/api/workspaces/${ws.id}/env`, {
  method: "PUT",
  body: JSON.stringify({ env: { CRM_KEY: "sk-crm-live-abc123", EDGE_KEY: "edge-secret-xyz" } }),
})
check("owner can set connections", r.status === 200, `status ${r.status}`)
check("PUT returns names only", JSON.stringify(r.body) === JSON.stringify({ keys: ["CRM_KEY", "EDGE_KEY"] }), JSON.stringify(r.body))
check("PUT response contains no secret value", !JSON.stringify(r.body).includes("sk-crm-live"))

r = await call(`/api/workspaces/${ws.id}/env`)
check("GET response contains no secret value", !JSON.stringify(r.body).includes("sk-crm-live"), JSON.stringify(r.body))

const stored = await prisma.workspace.findUnique({ where: { id: ws.id }, select: { environmentVariables: true } })
const raw = JSON.stringify(stored.environmentVariables)
check("stored at rest encrypted, not plaintext", !raw.includes("sk-crm-live-abc123") && raw.length > 40)

r = await call(`/api/workspaces/${ws.id}/env`, { method: "PUT", body: JSON.stringify({ env: { "bad-name": "x" } }) })
check("invalid variable name rejected", r.status === 400, `status ${r.status}`)

r = await call(`/api/workspaces/${ws.id}/env`, { method: "PUT", body: JSON.stringify({ env: { EDGE_KEY: null } }) })
check("null value deletes a key", r.status === 200 && JSON.stringify(r.body.keys) === JSON.stringify(["CRM_KEY"]), JSON.stringify(r.body))
check("delete did not wipe the other key", r.body.keys.includes("CRM_KEY"))

// non-owner cannot write
const outsider = await prisma.user.create({ data: { name: "Outsider" } })
const call3 = api(await cookieFor(outsider.id))
r = await call3(`/api/workspaces/${ws.id}/env`, { method: "PUT", body: JSON.stringify({ env: { CRM_KEY: "hijack" } }) })
check("non-member cannot set connections", r.status === 403, `status ${r.status}`)
r = await call3(`/api/workspaces/${ws.id}/env`)
check("non-member cannot even list key names", r.status === 403, `status ${r.status}`)
await call3(`/api/workspaces/${ws.id}/membership`, { method: "POST" })
r = await call3(`/api/workspaces/${ws.id}/env`, { method: "PUT", body: JSON.stringify({ env: { CRM_KEY: "hijack" } }) })
check("plain member still cannot set connections", r.status === 403, `status ${r.status}`)
r = await call3(`/api/workspaces/${ws.id}/env`)
check("plain member CAN list key names", r.status === 200 && r.body.keys.includes("CRM_KEY"), `status ${r.status}`)
await prisma.user.delete({ where: { id: outsider.id } }).catch(() => {})

// (decrypt round-trip is covered by lib/workspace.test.ts — node cannot
// import the TS helper directly from here.)

// ── 8. unauth ─────────────────────────────────────────────────────────────
console.log("\n8. auth gate")
const anon = await fetch(`${BASE}/api/workspaces`).then((x) => x.status)
check("no cookie → 401", anon === 401, `status ${anon}`)

await prisma.user.delete({ where: { id: other.id } }).catch(() => {})
console.log(`\n${"─".repeat(60)}\n${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
