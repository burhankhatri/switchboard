import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, forbidden, badRequest } from "@/lib/db/api-helpers"

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST — refused. Joining is not self-serve.
 *
 * This used to upsert the caller straight into the workspace, checking only
 * that they were signed in. Membership is not a label: it decrypts that
 * workspace's connection secrets into the sandbox on every run, so anyone who
 * could reach this endpoint could take a live CRM token and an outbound email
 * key. The only thing preventing that was an allowlist on sign-in, which meant
 * the product could never be opened up without giving strangers those
 * credentials.
 *
 * An owner adds people through POST /api/workspaces/[id]/members, which checks
 * ownership and tells the person they were added. Kept as an explicit 403
 * rather than deleted so an old client gets a reason instead of a 405 that
 * reads like a bug.
 */
export async function POST(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  return forbidden("Ask a workspace owner to add you — workspaces are invite-only")
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
