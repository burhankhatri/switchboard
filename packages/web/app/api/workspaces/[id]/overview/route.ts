import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace"
import { CONNECTION_SELECT, restEnvNames } from "@/lib/workspace-connections"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Everything the workspace panels need, in one request.
 *
 * Opening a workspace used to fan out to four endpoints — files, connections,
 * members, runs — and each one independently resolved the session, re-checked
 * membership, then ran its own query. Against a cross-region database that is
 * roughly a quarter-second per round trip, and because they fire together they
 * also queue behind each other on the connection pool: measured at 2.5s to open
 * a workspace, which is most of why the app felt slow.
 *
 * Membership is checked once here, then the reads run concurrently on one
 * request. The file tree is deliberately NOT included: it is a GitHub call
 * rather than a database one, it is already ETag-cached, and folding it in
 * would make the whole panel wait on the slowest of the two systems.
 */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    const [connections, members, runs] = await Promise.all([
      prisma.workspaceConnection.findMany({
        where: { workspaceId: id },
        orderBy: { name: "asc" },
        select: CONNECTION_SELECT,
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId: id },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        select: {
          role: true,
          joinedAt: true,
          user: {
            select: { id: true, name: true, email: true, image: true, githubLogin: true },
          },
        },
      }),
      prisma.scheduledJobRun.findMany({
        where: { job: { workspaceId: id } },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: { id: true, status: true, startedAt: true, completedAt: true },
      }),
    ])

    return Response.json({
      yourRole: gate.role,
      // Secrets never leave the server; only whether one is set, and the names
      // of the variables it becomes.
      connections: connections.map(({ encryptedSecret, ...c }) => ({
        ...c,
        hasSecret: !!encryptedSecret,
        env: c.kind === "rest" ? restEnvNames(c.slug) : null,
      })),
      members: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        githubLogin: m.user.githubLogin,
        role: m.role,
        joinedAt: m.joinedAt,
        isYou: m.user.id === auth.userId,
      })),
      runs,
    })
  } catch (err) {
    return internalError(err)
  }
}
