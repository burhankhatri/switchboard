/**
 * Full verification of the workspace product, against real infrastructure.
 *
 * Hits the running app over HTTP, the real database, and the real GitHub repo.
 * Nothing here is mocked, because the things most likely to be wrong — auth
 * gates, credential injection, chat binding — are precisely the things a mock
 * would paper over.
 *
 * Run from packages/web with the dev server up:
 *   npx dotenv -e .env.local -- npx tsx ../../scripts/verify-all.mjs
 */
import { encode } from "next-auth/jwt"
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { WORKSPACE_RUNTIME_SELECT, workspaceSessionOptions } from "../packages/web/lib/workspace.ts"
import { restConnectionEnv } from "../packages/web/lib/workspace-connections.ts"

const BASE = process.env.VERIFY_BASE ?? "http://localhost:4000"
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
})

let pass = 0
const failures = []
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures.push(`${name} — ${String(detail).slice(0, 200)}`)
    console.log(`  \x1b[31m✗\x1b[0m ${name}  \x1b[2m${String(detail).slice(0, 120)}\x1b[0m`)
  }
}
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const cookieFor = async (userId) =>
  `next-auth.session-token=${await encode({ token: { sub: userId }, secret: process.env.NEXTAUTH_SECRET })}`
const client = (cookie) => (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })

// ── fixtures ────────────────────────────────────────────────────────────────
const owner = await prisma.user.findFirst({ where: { githubLogin: "burhankhatri" }, select: { id: true } })
const mate = await prisma.user.findFirst({ where: { githubLogin: "chemicoholic21" }, select: { id: true } })
const mkt = await prisma.workspace.findFirst({ where: { slug: "marketing-automation" }, select: { id: true, path: true, repo: true } })
const lead = await prisma.workspace.findFirst({ where: { slug: "lead-gen" }, select: { id: true, path: true } })
if (!owner || !mate || !mkt || !lead) {
  console.error("Missing fixtures (users or workspaces). Cannot verify.")
  process.exit(1)
}
const asOwner = client(await cookieFor(owner.id))
const asMate = client(await cookieFor(mate.id))
const anon = (path) => fetch(`${BASE}${path}`)

// ── 1. auth boundaries ──────────────────────────────────────────────────────
section("Authentication")
let r = await anon("/api/workspaces")
check("signed-out cannot list workspaces", r.status === 401, `got ${r.status}`)
r = await anon(`/api/workspaces/${mkt.id}/overview`)
check("signed-out cannot read a workspace", r.status === 401, `got ${r.status}`)

// ── 2. membership as an authorization boundary ──────────────────────────────
section("Membership gates access")
await prisma.workspaceMember.deleteMany({ where: { workspaceId: mkt.id, userId: mate.id } })
for (const [label, path] of [
  ["connections", `/api/workspaces/${mkt.id}/connections`],
  ["members", `/api/workspaces/${mkt.id}/members`],
  ["overview", `/api/workspaces/${mkt.id}/overview`],
  ["files", `/api/workspaces/${mkt.id}/files`],
]) {
  const res = await asMate(path)
  check(`non-member refused: ${label}`, res.status === 403, `got ${res.status}`)
}
r = await asOwner(`/api/chats`, { method: "POST", body: JSON.stringify({ workspaceId: mkt.id }) })
const ownerChat = await r.json()
check("owner may create a chat in their workspace", r.ok, JSON.stringify(ownerChat).slice(0, 120))
r = await asMate(`/api/chats`, { method: "POST", body: JSON.stringify({ workspaceId: mkt.id }) })
check("non-member cannot bind a chat to it", r.status === 403, `got ${r.status}`)

// ── 3. adding someone: the product's core move ──────────────────────────────
section("A lead adds a colleague by GitHub username")
r = await asOwner(`/api/workspaces/${mkt.id}/members`, { method: "POST", body: JSON.stringify({ identifier: "chemicoholic21" }) })
let body = await r.json()
check("added by handle", r.ok && body.added === true, body.error)
r = await asOwner(`/api/workspaces/${mkt.id}/members`, { method: "POST", body: JSON.stringify({ identifier: "@CHEMICOHOLIC21" }) })
body = await r.json()
check("idempotent, tolerates @ and casing", r.ok && body.alreadyMember === true, body.error)
r = await asOwner(`/api/workspaces/${mkt.id}/members`, { method: "POST", body: JSON.stringify({ identifier: "nobody@nowhere.test" }) })
body = await r.json()
check("unknown person gets an actionable message", r.status === 400 && /sign in/i.test(body.error ?? ""), body.error)

section("…and it works immediately, with no setup on their side")
r = await asMate(`/api/workspaces/${mkt.id}/overview`)
body = await r.json()
check("sees the workspace", r.ok, `got ${r.status}`)
check("inherits both ad connections", body.connections?.length === 2, JSON.stringify(body.connections?.map((c) => c.slug)))
check("never receives a secret", !JSON.stringify(body).includes("ya29.") && !JSON.stringify(body).includes("EAAG."))
check("secrets reported as present, not disclosed", body.connections?.every((c) => c.hasSecret === true))
r = await asMate(`/api/chats`, { method: "POST", body: JSON.stringify({ workspaceId: mkt.id }) })
const mateChat = await r.json()
check("can now start a chat in it", r.ok, JSON.stringify(mateChat).slice(0, 120))

// ── 4. roles ────────────────────────────────────────────────────────────────
section("Roles")
r = await asMate(`/api/workspaces/${mkt.id}/members`, { method: "POST", body: JSON.stringify({ identifier: "x@y.test" }) })
check("a member cannot add others", r.status === 403, `got ${r.status}`)
r = await asOwner(`/api/workspaces/${mkt.id}/members/${owner.id}`, { method: "PATCH", body: JSON.stringify({ role: "member" }) })
body = await r.json()
check("the last owner cannot demote themselves", r.status === 400 && /last owner/i.test(body.error ?? ""), body.error)
r = await asOwner(`/api/workspaces/${mkt.id}/members/${mate.id}`, { method: "PATCH", body: JSON.stringify({ role: "owner" }) })
check("owner can promote", r.ok, `got ${r.status}`)
r = await asOwner(`/api/workspaces/${mkt.id}/members/${mate.id}`, { method: "PATCH", body: JSON.stringify({ role: "member" }) })
check("owner can demote", r.ok, `got ${r.status}`)

// ── 5. chat binding — the bug that broke the demo ───────────────────────────
section("A chat carries its workspace into the run")
const chatRow = await prisma.chat.findUnique({
  where: { id: ownerChat.id },
  select: { repo: true, workspaceId: true, agent: true },
})
check("bound to the workspace", chatRow?.workspaceId === mkt.id, JSON.stringify(chatRow))
check("inherits the workspaces repo, not __new__", chatRow?.repo === mkt.repo, chatRow?.repo)
check("uses a canonical agent id", ["claude-code", "opencode"].includes(chatRow?.agent ?? ""), chatRow?.agent)

// ── 6. what actually reaches the agent ──────────────────────────────────────
section("What the agent receives, every run")
const runtime = await prisma.workspace.findFirst({ where: { id: mkt.id }, select: WORKSPACE_RUNTIME_SELECT })
const opts = workspaceSessionOptions(runtime)
const env = restConnectionEnv(runtime.connections, runtime.slug)
check("cwd is the workspace folder", opts.workspacePath === mkt.path, opts.workspacePath)
check("prompt names Google Ads", /Google Ads/.test(opts.workspaceSystemPrompt ?? ""))
check("prompt names Meta Ads", /Meta Ads/.test(opts.workspaceSystemPrompt ?? ""))
check("prompt steers to the scripts, not raw HTTP", /Do not call this endpoint directly/.test(opts.workspaceSystemPrompt ?? ""))
// Whitespace-tolerant: the generated prose is hard-wrapped, so a literal
// single-space match fails on a phrase that happens to straddle a line break.
check("prompt forbids printing credentials", /never\s+print\s+them/i.test(opts.workspaceSystemPrompt ?? ""))
check(
  "all four env vars injected",
  Object.keys(env).sort().join(",") === "GOOGLE_ADS_BASE_URL,GOOGLE_ADS_TOKEN,META_ADS_BASE_URL,META_ADS_TOKEN",
  Object.keys(env).join(",")
)
check("base URLs are the real production endpoints", env.GOOGLE_ADS_BASE_URL?.startsWith("https://googleads.googleapis.com"), env.GOOGLE_ADS_BASE_URL)
// Only the TOKENs are secret. Base URLs are deliberately in the prompt — the
// agent needs to know where the API is; it must never be told the credential.
check(
  "prompt never contains a token value",
  !Object.entries(env)
    .filter(([k]) => k.endsWith("_TOKEN"))
    .some(([, v]) => (opts.workspaceSystemPrompt ?? "").includes(v))
)

// ── 7. connections are re-read per run ──────────────────────────────────────
section("Connection changes are picked up on the next run")
const marker = `verify-${Date.now()}`
await prisma.workspaceConnection.updateMany({ where: { workspaceId: mkt.id, slug: "google-ads" }, data: { description: marker } })
const reread = await prisma.workspace.findFirst({ where: { id: mkt.id }, select: WORKSPACE_RUNTIME_SELECT })
check("an edited description appears without a restart", (workspaceSessionOptions(reread).workspaceSystemPrompt ?? "").includes(marker))
await prisma.workspaceConnection.updateMany({
  where: { workspaceId: mkt.id, slug: "google-ads" },
  data: { description: "Google Ads API v18 (campaign reporting via GAQL searchStream). Do not call this endpoint directly — use the workspace scripts, which handle the request shape, the batched response and the costMicros conversion: python scripts/ads_report.py --platform google" },
})

// ── 8. workspace files ──────────────────────────────────────────────────────
section("Workspace contents in the repo")
r = await asOwner(`/api/workspaces/${mkt.id}/files`)
body = await r.json()
const names = (body.workspace ?? []).map((f) => f.name)
for (const required of [
  "workspace.yaml",
  "scripts/ads_report.py",
  "lib/ads_transport.py",
  "lib/google_ads.py",
  "lib/meta_ads.py",
  "fixtures/google_ads/campaign_performance.json",
  "fixtures/meta_ads/campaign_performance.json",
  ".claude/skills/marketing-automation/SKILL.md",
]) {
  check(`present: ${required}`, names.includes(required), names.slice(0, 4).join(", "))
}

// ── 9. path containment ─────────────────────────────────────────────────────
section("A workspace cannot read outside itself")
r = await asOwner(`/api/workspaces/${mkt.id}/files?path=${encodeURIComponent(lead.path + "/workspace.yaml")}`)
check("refuses another workspace's file", r.status === 403, `got ${r.status}`)
r = await asOwner(`/api/workspaces/${mkt.id}/files?path=${encodeURIComponent("../../etc/passwd")}`)
check("refuses traversal", r.status === 403 || r.status === 400, `got ${r.status}`)

// ── 10. removal revokes ─────────────────────────────────────────────────────
section("Removing someone revokes access")
r = await asOwner(`/api/workspaces/${mkt.id}/members/${mate.id}`, { method: "DELETE" })
check("owner can remove", r.ok, `got ${r.status}`)
r = await asMate(`/api/workspaces/${mkt.id}/overview`)
check("removed member is locked out", r.status === 403, `got ${r.status}`)
r = await asMate(`/api/chats`, { method: "POST", body: JSON.stringify({ workspaceId: mkt.id }) })
check("and cannot bind a new chat", r.status === 403, `got ${r.status}`)

// ── cleanup ─────────────────────────────────────────────────────────────────
for (const id of [ownerChat?.id, mateChat?.id]) {
  if (id) await prisma.chat.delete({ where: { id } }).catch(() => {})
}

console.log(`\n${"─".repeat(64)}`)
if (failures.length === 0) {
  console.log(`\x1b[32m${pass} checks passed, 0 failed\x1b[0m`)
} else {
  console.log(`\x1b[31m${pass} passed, ${failures.length} FAILED\x1b[0m`)
  failures.forEach((f) => console.log(`  • ${f}`))
}
await prisma.$disconnect()
process.exit(failures.length ? 1 : 0)
