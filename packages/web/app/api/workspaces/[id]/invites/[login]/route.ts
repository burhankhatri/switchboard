import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  forbidden,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import { normalizeGithubLogin } from "@/lib/db/workspace-invites"

type Ctx = { params: Promise<{ id: string; login: string }> }

/**
 * Withdrawing an invite that has not been claimed.
 *
 * Separate from the member routes because a pending invite has no user id to
 * address it by — that is the entire point of it. Owner-only for the same
 * reason adding is: the invite is a standing grant of the workspace's
 * credentials to whoever signs in under that handle, so leaving no way to take
 * it back would make a typo permanent.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, login } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: { id: true, slug: true },
  })
  if (!workspace) return notFound("Workspace not found")

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId: auth.userId } },
    select: { role: true },
  })
  if (!membership) return forbidden("Join this workspace first")
  if (membership.role !== "owner") {
    return forbidden("Only workspace owners can manage members")
  }

  try {
    const handle = normalizeGithubLogin(decodeURIComponent(login))
    const { count } = await prisma.workspaceInvite.deleteMany({
      where: { workspaceId: id, githubLogin: handle },
    })
    if (count > 0) {
      logActivityAsync(auth.userId, "workspace_invite_revoked", {
        workspaceSlug: workspace.slug,
        githubLogin: handle,
      })
    }
    return Response.json({ revoked: count > 0 })
  } catch (err) {
    return internalError(err)
  }
}
