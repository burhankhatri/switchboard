import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  forbidden,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"

type Ctx = { params: Promise<{ id: string; userId: string }> }

async function gateOwner(workspaceId: string, callerId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, archived: false },
    select: { id: true, slug: true },
  })
  if (!workspace) return { ok: false as const, response: notFound("Workspace not found") }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: callerId } },
    select: { role: true },
  })
  if (!membership) return { ok: false as const, response: forbidden("Join this workspace first") }
  if (membership.role !== "owner") {
    return { ok: false as const, response: forbidden("Only workspace owners can manage members") }
  }
  return { ok: true as const, workspace }
}

/**
 * Refuse anything that would leave the workspace with no owner.
 *
 * A workspace whose last owner is gone cannot have its members, connections or
 * settings changed by anyone — it is not recoverable through the UI. Cheaper to
 * refuse here than to explain later.
 */
async function wouldOrphan(workspaceId: string, targetUserId: string): Promise<boolean> {
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    select: { role: true },
  })
  if (target?.role !== "owner") return false
  const owners = await prisma.workspaceMember.count({
    where: { workspaceId, role: "owner" },
  })
  return owners <= 1
}

interface PatchBody {
  role?: string
}

/**
 * PATCH — change someone's role.
 *
 * The old leave endpoint told the last owner to "promote someone else first"
 * while offering no way to promote anyone. This is that missing endpoint.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, userId } = await params

  const g = await gateOwner(id, auth.userId)
  if (!g.ok) return g.response

  try {
    const body: PatchBody = await req.json()
    if (body.role !== "owner" && body.role !== "member") {
      return badRequest('role must be "owner" or "member"')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
      select: { role: true },
    })
    if (!member) return notFound("That person is not a member of this workspace")

    if (body.role === "member" && (await wouldOrphan(id, userId))) {
      return badRequest("This is the last owner — promote someone else first")
    }

    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: id, userId } },
      data: { role: body.role },
    })
    logActivityAsync(auth.userId, "workspace_member_role_changed", {
      workspaceSlug: g.workspace.slug,
      targetUserId: userId,
      role: body.role,
    })

    return Response.json({ userId, role: body.role })
  } catch (err) {
    return internalError(err)
  }
}

/**
 * DELETE — remove someone else from the workspace.
 *
 * Removing a member revokes their access to the workspace's credentials on the
 * next run: agent-env re-checks membership every time rather than trusting the
 * chat's binding, so this takes effect immediately rather than at next login.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, userId } = await params

  const g = await gateOwner(id, auth.userId)
  if (!g.ok) return g.response

  try {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
      select: { role: true },
    })
    if (!member) return Response.json({ removed: false })

    if (await wouldOrphan(id, userId)) {
      return badRequest("This is the last owner — promote someone else first")
    }

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    })
    logActivityAsync(auth.userId, "workspace_member_removed", {
      workspaceSlug: g.workspace.slug,
      targetUserId: userId,
    })

    return Response.json({ removed: true })
  } catch (err) {
    return internalError(err)
  }
}
