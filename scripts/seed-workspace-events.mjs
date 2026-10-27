// Backfill the workspace activity feed from history that predates it.
//
// A feed that starts empty on the day it ships tells a new member nothing, but
// the facts are already in the database: scheduled runs and memberships. This
// writes one event per finished run and per membership, dated when it actually
// happened, so "since you were last here" and the feed read correctly at once.
//
// Idempotent: a run is skipped if an event of the same kind already names it,
// and a membership if a member_joined event already exists for that person in
// that workspace. Safe to re-run.
//
//   cd packages/web && npx dotenv -e .env.local -- node ../../scripts/seed-workspace-events.mjs [--dry-run]
//
// Requires the workspace_home migration to be applied first.

import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"

const dryRun = process.argv.includes("--dry-run")
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) })

const clamp = (s) => {
  const flat = String(s).replace(/\s+/g, " ").trim()
  return flat.length > 280 ? `${flat.slice(0, 279)}…` : flat
}

async function seedRuns() {
  const runs = await prisma.scheduledJobRun.findMany({
    where: { status: { in: ["completed", "error"] }, job: { workspaceId: { not: null } } },
    select: {
      id: true, status: true, startedAt: true, completedAt: true, chatId: true,
      commitCount: true, prUrl: true, error: true,
      job: { select: { id: true, name: true, workspaceId: true } },
    },
  })
  const existing = new Set(
    (await prisma.workspaceEvent.findMany({
      where: { kind: { in: ["run_completed", "run_failed"] }, runId: { not: null } },
      select: { kind: true, runId: true },
    })).map((e) => `${e.kind}:${e.runId}`)
  )

  let written = 0
  for (const run of runs) {
    const kind = run.status === "error" ? "run_failed" : "run_completed"
    if (existing.has(`${kind}:${run.id}`)) continue
    const summary =
      kind === "run_failed"
        ? `${run.job.name} failed: ${run.error ?? "unknown error"}`
        : run.commitCount > 0
          ? `${run.job.name} ran and committed ${run.commitCount} change${run.commitCount === 1 ? "" : "s"}${run.prUrl ? " for review" : ""}`
          : `${run.job.name} ran`
    if (!dryRun) {
      await prisma.workspaceEvent.create({
        data: {
          workspaceId: run.job.workspaceId,
          kind,
          summary: clamp(summary),
          jobId: run.job.id,
          runId: run.id,
          chatId: run.chatId,
          createdAt: run.completedAt ?? run.startedAt,
        },
      })
    }
    written++
  }
  return written
}

async function seedMembers() {
  const members = await prisma.workspaceMember.findMany({
    select: { workspaceId: true, userId: true, joinedAt: true },
  })
  const existing = new Set(
    (await prisma.workspaceEvent.findMany({
      where: { kind: "member_joined" },
      select: { workspaceId: true, actorUserId: true },
    })).map((e) => `${e.workspaceId}:${e.actorUserId}`)
  )

  let written = 0
  for (const m of members) {
    if (existing.has(`${m.workspaceId}:${m.userId}`)) continue
    if (!dryRun) {
      await prisma.workspaceEvent.create({
        data: {
          workspaceId: m.workspaceId,
          kind: "member_joined",
          summary: "Joined the workspace",
          actorUserId: m.userId,
          createdAt: m.joinedAt,
        },
      })
    }
    written++
  }
  return written
}

try {
  const runs = await seedRuns()
  const members = await seedMembers()
  console.log(`${dryRun ? "[dry run] would write" : "wrote"} ${runs} run events, ${members} membership events`)
} finally {
  await prisma.$disconnect()
}
