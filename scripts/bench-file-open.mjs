/**
 * Measure what opening a workspace file actually costs.
 *
 * Hits the real endpoint against the real database and the real GitHub API —
 * the only way to know whether the caching work moved the number, since every
 * layer being optimised (Neon round trips, GitHub round trips) is remote.
 *
 * Reports cold (first call, nothing warm) separately from warm, because they
 * are different claims: cold is "the serial round trips are gone", warm is
 * "the ETag cache is doing its job".
 *
 * Run from packages/web with the dev server up:
 *   npx dotenv -e .env.local -- node ../../scripts/bench-file-open.mjs
 */
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { encode } from "next-auth/jwt"

const BASE = process.env.BENCH_BASE ?? "http://localhost:4000"
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 6)

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
})

const ms = (n) => `${n.toFixed(0)}ms`

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  }
}

async function time(fn) {
  const started = performance.now()
  const result = await fn()
  return { ms: performance.now() - started, result }
}

const workspace = await prisma.workspace.findFirst({
  where: { archived: false },
  select: { id: true, name: true, path: true, members: { select: { userId: true }, take: 1 } },
})
if (!workspace) {
  console.error("No workspace found — seed one first.")
  process.exit(1)
}
const userId = workspace.members[0]?.userId
if (!userId) {
  console.error(`Workspace ${workspace.name} has no members; cannot mint a session.`)
  process.exit(1)
}

const token = await encode({ token: { sub: userId }, secret: process.env.NEXTAUTH_SECRET })
const cookie = `next-auth.session-token=${token}`
const get = (path) =>
  fetch(`${BASE}${path}`, { headers: { cookie } }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }))

console.log(`workspace: ${workspace.name} (${workspace.path})`)

// Discover a real file to read, and time the tree listing while we are here.
const tree = await time(() => get(`/api/workspaces/${workspace.id}/files`))
if (tree.result.status !== 200) {
  console.error(`Tree listing failed: ${tree.result.status}`, tree.result.body)
  process.exit(1)
}
const files = tree.result.body.workspace ?? []
if (files.length === 0) {
  console.error("Workspace has no files to read.")
  process.exit(1)
}
const target = files[0].path
console.log(`file:      ${target}`)
console.log(`tree cold: ${ms(tree.ms)}\n`)

const cold = await time(() =>
  get(`/api/workspaces/${workspace.id}/files?path=${encodeURIComponent(target)}`)
)
if (cold.result.status !== 200) {
  console.error(`Read failed: ${cold.result.status}`, cold.result.body)
  process.exit(1)
}

const warm = []
for (let i = 0; i < ROUNDS; i++) {
  const run = await time(() =>
    get(`/api/workspaces/${workspace.id}/files?path=${encodeURIComponent(target)}`)
  )
  warm.push(run.ms)
}
const treeWarm = []
for (let i = 0; i < ROUNDS; i++) {
  const run = await time(() => get(`/api/workspaces/${workspace.id}/files`))
  treeWarm.push(run.ms)
}

const w = stats(warm)
const t = stats(treeWarm)
console.log(`file read  cold:   ${ms(cold.ms)}`)
console.log(
  `file read  warm:   median ${ms(w.median)}  (min ${ms(w.min)}, max ${ms(w.max)}, n=${ROUNDS})`
)
console.log(
  `tree list  warm:   median ${ms(t.median)}  (min ${ms(t.min)}, max ${ms(t.max)}, n=${ROUNDS})`
)

await prisma.$disconnect()
