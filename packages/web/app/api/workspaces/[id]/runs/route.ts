import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, notFound, forbidden } from "@/lib/db/api-helpers"

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/:id/runs — scheduled runs across this workspace's jobs.
 *
 * The per-job endpoint already exists, but a workspace's value is the whole
 * picture: "is anything failing here" cannot be answered by opening each job in
 * turn, which is exactly why a silently failing cron stays unnoticed.
 *
 * Members only, since a run's error text can quote a system of record.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: { id: true, members: { where: { userId: auth.userId }, select: { role: true } } },
  })
  if (!workspace) return notFound("Workspace not found")
  if (workspace.members.length === 0) return forbidden("Join this workspace first")

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100)

  const runs = await prisma.scheduledJobRun.findMany({
    where: { job: { workspaceId: id } },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true, status: true, startedAt: true, completedAt: true,
      commitCount: true, prUrl: true, error: true,
      job: { select: { name: true } },
    },
  })

  return Response.json({
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      commitCount: r.commitCount,
      prUrl: r.prUrl,
      error: r.error,
      jobName: r.job.name,
    })),
  })
}
