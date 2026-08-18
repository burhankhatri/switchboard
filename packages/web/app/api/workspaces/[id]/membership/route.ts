import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, notFound, badRequest } from "@/lib/db/api-helpers"

type Ctx = { params: Promise<{ id: string }> }

/** POST — join a workspace. Idempotent: joining twice is not an error. */
export async function POST(_req: Request, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: { id: true },
  })
  if (!workspace) return notFound("Workspace not found")

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: id, userId } },
    create: { workspaceId: id, userId, role: "member" },
    update: {},
  })

  return Response.json({ joined: true })
}

/**
 * DELETE — leave a workspace.
 *
 * Refuses to remove the last owner: a shared workspace with no owner cannot be
 * administered by anyone, and the failure would only surface later when someone
 * tried to change its settings.
 */
export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id } = await params

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId } },
    select: { role: true },
  })
  if (!membership) return Response.json({ joined: false })

  if (membership.role === "owner") {
    const owners = await prisma.workspaceMember.count({
      where: { workspaceId: id, role: "owner" },
    })
    if (owners <= 1) {
      return badRequest("You are the last owner — promote someone else first")
    }
  }

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: id, userId } },
  })
  return Response.json({ joined: false })
}
