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
import { notifyAsync } from "@/lib/db/notifications"
import {
  normalizeGithubLogin,
  isValidGithubLogin,
} from "@/lib/db/workspace-invites"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Members of a workspace.
 *
 * The existing membership route is self-service — it only lets the caller join
 * or leave. That leaves out the thing this product exists for: a lead who has
 * built a working setup adds their team to it, and the team gets the skills,
 * the scripts and the credentials without doing anything. These endpoints are
 * that.
 *
 * Adding someone grants them the workspace's credentials, so it is owner-only,
 * for the same reason creating a connection is.
 */

async function gate(workspaceId: string, userId: string, needOwner: boolean) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, archived: false },
    select: { id: true, slug: true, name: true },
  })
  if (!workspace) return { ok: false as const, response: notFound("Workspace not found") }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) return { ok: false as const, response: forbidden("Join this workspace first") }
  if (needOwner && membership.role !== "owner") {
    return { ok: false as const, response: forbidden("Only workspace owners can manage members") }
  }
  return { ok: true as const, workspace, role: membership.role }
}

/** GET — who is in this workspace. Any member may see the roster. */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const g = await gate(id, auth.userId, false)
  if (!g.ok) return g.response

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: id },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: {
      role: true,
      joinedAt: true,
      user: { select: { id: true, name: true, email: true, image: true, githubLogin: true } },
    },
  })

  // Invites sit alongside the roster rather than in their own list: to the
  // person reading it they are the same question — who has access to this.
  const invites = await prisma.workspaceInvite.findMany({
    where: { workspaceId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, githubLogin: true, role: true, createdAt: true },
  })

  return Response.json({
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
    invites: invites.map((i) => ({
      id: i.id,
      githubLogin: i.githubLogin,
      role: i.role,
      invitedAt: i.createdAt,
    })),
    yourRole: g.role,
  })
}

interface AddBody {
  /** Email, display name, or GitHub login. */
  identifier?: string
  role?: string
}

/**
 * POST — add someone to the workspace.
 *
 * If they have an account they become a member immediately. If they do not,
 * the GitHub handle is recorded as an invite and claimed on their first
 * sign-in. This used to be a 400 telling the owner to chase them and come back
 * afterwards, which meant onboarding stalled on the one person who was not in
 * the room. Nothing is emailed: a GitHub handle does not give us an address,
 * and the claim does not need one — signing in is enough, however they get
 * there.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const g = await gate(id, auth.userId, true)
  if (!g.ok) return g.response

  try {
    const body: AddBody = await req.json()
    const identifier = body.identifier?.trim()
    if (!identifier) return badRequest("An email or GitHub username is required")

    const role = body.role === "owner" ? "owner" : "member"

    // GitHub handle first — it is what a colleague actually knows and the whole
    // point of "just add their username". Email and display name are accepted
    // too because not every account has a login stored yet.
    const handle = identifier.replace(/^@/, "")
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { githubLogin: { equals: handle, mode: "insensitive" } },
          { email: { equals: identifier, mode: "insensitive" } },
          { name: { equals: identifier, mode: "insensitive" } },
          { githubId: handle },
        ],
      },
      select: { id: true, name: true, email: true, image: true, githubLogin: true },
    })
    if (!user) {
      // No account yet. An email or a display name identifies nobody we can
      // match at sign-in — GitHub reports a login and nothing else — so only a
      // handle can become an invite.
      const pendingHandle = normalizeGithubLogin(identifier)
      if (!isValidGithubLogin(pendingHandle)) {
        return badRequest(
          `No account for "${identifier}", and it is not a GitHub username we can hold an invite against. Invite them by their GitHub handle instead.`
        )
      }

      // Re-inviting is how you change a pending invite's role, so upsert rather
      // than refuse — refusing would leave no way to correct a mistyped role
      // short of revoking first.
      const invite = await prisma.workspaceInvite.upsert({
        where: { workspaceId_githubLogin: { workspaceId: id, githubLogin: pendingHandle } },
        create: {
          workspaceId: id,
          githubLogin: pendingHandle,
          role,
          invitedById: auth.userId,
        },
        update: { role, invitedById: auth.userId },
        select: { id: true, githubLogin: true, role: true, createdAt: true },
      })
      logActivityAsync(auth.userId, "workspace_invite_sent", {
        workspaceSlug: g.workspace.slug,
        githubLogin: pendingHandle,
        role,
      })

      return Response.json({
        added: false,
        invited: true,
        invite: {
          id: invite.id,
          githubLogin: invite.githubLogin,
          role: invite.role,
          invitedAt: invite.createdAt,
        },
      })
    }

    // They have an account now, so any invite still sitting there is stale.
    // Left behind it would re-add them after a later removal. Keyed off their
    // stored handle rather than what was typed: the match above also accepts an
    // email or a display name, neither of which an invite is filed under.
    if (user.githubLogin) {
      await prisma.workspaceInvite
        .deleteMany({
          where: { workspaceId: id, githubLogin: normalizeGithubLogin(user.githubLogin) },
        })
        .catch(() => {})
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: user.id } },
      select: { role: true },
    })
    if (existing) {
      return Response.json({
        added: false,
        alreadyMember: true,
        member: { userId: user.id, name: user.name, email: user.email, role: existing.role },
      })
    }

    await prisma.workspaceMember.create({
      data: { workspaceId: id, userId: user.id, role },
    })
    logActivityAsync(auth.userId, "workspace_member_added", {
      workspaceSlug: g.workspace.slug,
      targetUserId: user.id,
      role,
    })

    // Membership is immediate — there is no invite to accept, which is the
    // point: you are added and the workspace works. But being silently granted
    // access to somebody's credentials is disorienting, so say so.
    const actor = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true, email: true },
    })
    notifyAsync({
      userId: user.id,
      actorId: auth.userId,
      kind: "workspace_member_added",
      title: `${actor?.name ?? actor?.email ?? "Someone"} added you to ${g.workspace.name}`,
      body: "You can open it from the workspace picker.",
      workspaceId: id,
    })

    return Response.json({
      added: true,
      member: {
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        githubLogin: user.githubLogin,
        role,
        isYou: false,
      },
    })
  } catch (err) {
    return internalError(err)
  }
}
