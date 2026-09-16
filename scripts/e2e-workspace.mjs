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
// Some assertions need a credential that can push to the workspaces repo. When
// there isn't one, saying so beats a row of FAILs that look like broken code.
let skip = 0
const skipped = (name, why) => {
  console.log(`  SKIP  ${name}  - ${why}`)
  skip++
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

// Every repo assertion, and the app's own commits, authenticate as this user.
// `findFirst` over all users picked whoever signed up first, whose OAuth token
// is long expired - so the run died at the first create with "Bad credentials"
// and read as a broken API. Prefer someone with a GitHub account on file;
// E2E_USER_ID overrides when that picks the wrong person.
const user = process.env.E2E_USER_ID
  ? await prisma.user.findUnique({ where: { id: process.env.E2E_USER_ID }, select: { id: true, name: true } })
  : (await prisma.account.findFirst({
      where: { provider: "github", NOT: { access_token: null } },
      select: { user: { select: { id: true, name: true } } },
    }))?.user ?? (await prisma.user.findFirst({ select: { id: true, name: true } }))
if (!user) { console.error("no user in db - sign in first"); process.exit(1) }
console.log(`acting as: ${user.name} (${user.id})\n`)
const call = api(await cookieFor(user.id))

// The direct GitHub checks below verify what the app committed. `gh` is not
// installed everywhere, so fall back to the same stored OAuth token the app
// authenticates its own repo reads and writes with - otherwise every repo
// assertion fails as a 404 and reads as a bug in the code under test.
if (!process.env.GH_TOKEN) {
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "github" },
    select: { access_token: true },
  })
  if (account?.access_token) {
    process.env.GH_TOKEN = account.access_token
    console.log("GH_TOKEN not set - using the signed-in user's stored GitHub token")
  } else {
    console.log("WARNING: no GH_TOKEN and no stored GitHub token; repo assertions will fail")
  }
}

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

// ── 10. skills ───────────────────────────────────────────────────────────────
console.log("\n10. workspace skills")

const ghHeaders = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: "application/vnd.github+json",
}
const repoPerms = await fetch(`https://api.github.com/repos/${process.env.WORKSPACES_REPO}`, {
  headers: ghHeaders,
}).then((x) => (x.ok ? x.json() : {})).then((b) => b.permissions ?? {})
// Writes go out under WORKSPACES_REPO_TOKEN when it is set, and under the
// acting user's OAuth token otherwise. Neither can commit without push.
const canPush = !!process.env.WORKSPACES_REPO_TOKEN || repoPerms.push === true
const noPush = "no credential with push to the workspaces repo (set WORKSPACES_REPO_TOKEN)"

r = await call(`/api/workspaces/${ws.id}/skills`)
check("GET skills returns 200", r.status === 200, `status ${r.status}`)
const starter = r.body.skills?.find((x) => x.slug === "lead-gen-guide")
check("the starter skill is listed", !!starter, JSON.stringify(r.body.skills ?? r.body).slice(0, 140))
check("its description comes from the frontmatter", !!starter?.description, String(starter?.description).slice(0, 80))
check("its path is the discovery path", starter?.path === `${ws.path}/.claude/skills/lead-gen-guide/SKILL.md`, String(starter?.path))
check("a loose file in .claude/skills is not a skill", !r.body.skills?.some((x) => x.slug.endsWith(".md")))

const NEW_SKILL_PATH = `${ws.path}/.claude/skills/campaign-audit/SKILL.md`
if (!canPush) {
  skipped("POST skills commits a SKILL.md", noPush)
  skipped("the server places it, slugified", noPush)
  skipped("a duplicate slug is refused", noPush)
} else {
  // Repeatable like the workspace row: the folder is left in the repo between
  // runs, so a create that should return 201 would hit the duplicate guard.
  const stale = await fetch(`https://api.github.com/repos/${process.env.WORKSPACES_REPO}/contents/${NEW_SKILL_PATH}`, {
    headers: ghHeaders,
  }).then((x) => (x.ok ? x.json() : null))
  if (stale?.sha) {
    await fetch(`https://api.github.com/repos/${process.env.WORKSPACES_REPO}/contents/${NEW_SKILL_PATH}`, {
      method: "DELETE",
      headers: ghHeaders,
      body: JSON.stringify({ message: "e2e: drop previous run's skill", sha: stale.sha }),
    })
  }

  r = await call(`/api/workspaces/${ws.id}/skills`, {
    method: "POST",
    body: JSON.stringify({ name: "Campaign Audit", description: "Weekly check of a live campaign: bounces, replies, sending volume." }),
  })
  check("POST skills returns 201", r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0,140)}`)
  check("the server placed it, slugified", r.body.skill?.path === NEW_SKILL_PATH, String(r.body.skill?.path))
  check("the SKILL.md is really in the repo", (await gh(NEW_SKILL_PATH)) === 200)

  // The frontmatter has to survive a description containing a colon - unquoted
  // it would parse as a different key and the skill would list as undescribed.
  r = await call(`/api/workspaces/${ws.id}/skills`)
  const added = r.body.skills?.find((x) => x.slug === "campaign-audit")
  check("the new skill reads back with its description", added?.description?.startsWith("Weekly check of a live campaign:"), String(added?.description))

  r = await call(`/api/workspaces/${ws.id}/skills`, {
    method: "POST",
    body: JSON.stringify({ name: "campaign audit", description: "A second one." }),
  })
  check("a duplicate slug is refused", r.status === 400, `status ${r.status}`)
}

// Validation runs before any write, so these hold with or without push.
r = await call(`/api/workspaces/${ws.id}/skills`, {
  method: "POST",
  body: JSON.stringify({ name: "No Description" }),
})
check("a skill with no description is refused", r.status === 400, `status ${r.status}`)

r = await call(`/api/workspaces/${ws.id}/skills`, {
  method: "POST",
  body: JSON.stringify({ name: "...", description: "Nothing usable in the name." }),
})
check("a name with no usable characters is refused", r.status === 400, `status ${r.status}`)

// A non-member needs a linked GitHub account, or requireGitHubAuth refuses at
// the auth gate (401) and the membership check below is never reached.
const stranger = await prisma.user.create({
  data: {
    name: "Stranger",
    accounts: {
      create: {
        type: "oauth",
        provider: "github",
        providerAccountId: `e2e-stranger-${Date.now()}`,
        access_token: "not-a-real-token",
      },
    },
  },
})
const call4 = api(await cookieFor(stranger.id))
r = await call4(`/api/workspaces/${ws.id}/skills`)
check("a non-member cannot list skills", r.status === 403, `status ${r.status}`)
r = await call4(`/api/workspaces/${ws.id}/skills`, {
  method: "POST",
  body: JSON.stringify({ name: "Sneak", description: "Should not land." }),
})
check("a non-member cannot add a skill", r.status === 403, `status ${r.status}`)
await prisma.user.delete({ where: { id: stranger.id } }).catch(() => {})

// ── 11. scheduled jobs bind to a workspace ────────────────────────────
console.log("\n11. scheduled jobs in a workspace")

r = await call("/api/scheduled-jobs", {
  method: "POST",
  body: JSON.stringify({
    name: "Weekly campaign audit",
    prompt: "Run scripts/campaign_audit.mjs and report what changed since last week.",
    workspaceId: ws.id,
    intervalMinutes: 10080,
  }),
})
check("a job can be created with only a workspace", r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0,140)}`)
const jobId = r.body?.id
check("the job is bound to the workspace", r.body?.workspaceId === ws.id, String(r.body?.workspaceId))
// Without denormalisation the job would fall to the repo-less path and clone
// nothing - the agent would start with none of the workspace's skills.
check("repo denormalised from the workspace", r.body?.repo === ws.repo, String(r.body?.repo))
check("baseBranch denormalised", r.body?.baseBranch === "main", String(r.body?.baseBranch))
check("agent denormalised", r.body?.agent === ws.agent, `${r.body?.agent} vs workspace ${ws.agent}`)

// Pins the contract the form depends on: an explicit value beats the
// workspace. That is why the form omits these inside a workspace - sending
// its own defaults made a workspace job run opencode against "main".
r = await call("/api/scheduled-jobs", {
  method: "POST",
  body: JSON.stringify({
    name: "Explicit override",
    prompt: "Check something.",
    workspaceId: ws.id,
    agent: "codex",
    intervalMinutes: 10080,
  }),
})
check("an explicit agent overrides the workspace", r.body?.agent === "codex", String(r.body?.agent))
if (r.body?.id) await prisma.scheduledJob.delete({ where: { id: r.body.id } }).catch(() => {})

r = await call("/api/scheduled-jobs")
check("the job lists with its workspace", r.body.jobs?.find((j) => j.id === jobId)?.workspaceId === ws.id)

// Same boundary as chats: naming a workspace is how its credentials reach a
// sandbox, so a non-member must not be able to name one.
const jobStranger = await prisma.user.create({ data: { name: "Job Stranger" } })
const call5 = api(await cookieFor(jobStranger.id))
r = await call5("/api/scheduled-jobs", {
  method: "POST",
  body: JSON.stringify({
    name: "Not mine",
    prompt: "Read the connections.",
    workspaceId: ws.id,
    intervalMinutes: 10080,
  }),
})
check("a non-member cannot bind a job to the workspace", r.status === 403, `status ${r.status}`)

r = await call(`/api/scheduled-jobs/${jobId}`, {
  method: "PATCH",
  body: JSON.stringify({ workspaceId: null }),
})
check("a job can be unbound from its workspace", r.status === 200 && r.body?.workspaceId === null, `status ${r.status} ${String(r.body?.workspaceId)}`)

if (jobId) await prisma.scheduledJob.delete({ where: { id: jobId } }).catch(() => {})
await prisma.user.delete({ where: { id: jobStranger.id } }).catch(() => {})

// ── 8. unauth ─────────────────────────────────────────────────────────────
console.log("\n8. auth gate")
const anon = await fetch(`${BASE}/api/workspaces`).then((x) => x.status)
check("no cookie → 401", anon === 401, `status ${anon}`)

await prisma.user.delete({ where: { id: other.id } }).catch(() => {})
console.log(`\n${"─".repeat(60)}\n${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
