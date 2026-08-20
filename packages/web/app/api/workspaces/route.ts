import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  requireGitHubAuth,
  isGitHubAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  ensureWorkspacesRepo,
  scaffoldWorkspace,
  slugify,
  WORKSPACES_REPO,
} from "@/lib/workspace-repo"
import { isSafeWorkspacePath } from "@/lib/git/ref-validation"

/**
 * GET /api/workspaces
 *
 * Every signed-in user sees every workspace — that is how you find one to join.
 * `joined` distinguishes the ones already in your sidebar from the rest.
 */
export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  // Members only. This used to return every workspace to every signed-in user
  // so the launcher could offer an "Available to join" list — which also handed
  // out each workspace's systemPrompt, describing how that team operates, to
  // people with no relationship to it. Joining is owner-driven now, so there is
  // nothing a non-member needs from this list.
  const workspaces = await prisma.workspace.findMany({
    where: { archived: false, members: { some: { userId } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      repo: true,
      path: true,
      agent: true,
      systemPrompt: true,
      createdAt: true,
      _count: { select: { members: true, chats: true } },
      members: { where: { userId }, select: { role: true } },
    },
  })

  return Response.json({
    workspaces: workspaces.map(({ members, _count, ...w }) => ({
      ...w,
      memberCount: _count.members,
      chatCount: _count.chats,
      joined: members.length > 0,
      role: members[0]?.role ?? null,
    })),
  })
}

interface CreateBody {
  name?: string
  systemPrompt?: string
  agent?: string
  env?: string[]
}

/**
 * POST /api/workspaces
 *
 * Creates the folder in the private workspaces repo, then the row. Repo first:
 * if the commit fails we have written nothing, whereas a row pointing at a
 * folder that does not exist would fail at spin-up, much later and less clearly.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth
  const { userId, token } = auth

  if (!WORKSPACES_REPO) {
    return badRequest("WORKSPACES_REPO is not configured on the server")
  }

  try {
    const body: CreateBody = await req.json()
    const name = body.name?.trim()
    if (!name) return badRequest("name is required")

    const slug = slugify(name)
    if (!slug) return badRequest("name must contain at least one letter or number")
    if (!isSafeWorkspacePath(`workspaces/${slug}`)) {
      return badRequest("name produces an unsafe path")
    }

    const clash = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })
    if (clash) return badRequest(`A workspace named "${name}" already exists`)

    const env = (body.env ?? [])
      .map((e) => e.trim().toUpperCase())
      .filter((e) => /^[A-Z][A-Z0-9_]*$/.test(e))

    const agent = body.agent ?? "claude"

    await ensureWorkspacesRepo(token)
    const { path } = await scaffoldWorkspace(token, {
      slug,
      name,
      systemPrompt: body.systemPrompt,
      agent,
      env,
    })

    // The creator is an owner member, not merely the createdBy — otherwise the
    // person who just made the workspace would have to "join" it.
    const workspace = await prisma.workspace.create({
      data: {
        slug,
        name,
        repo: WORKSPACES_REPO,
        path,
        agent,
        systemPrompt: body.systemPrompt?.trim() || null,
        createdById: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, slug: true, name: true, repo: true, path: true, agent: true },
    })

    return Response.json({ workspace, joined: true }, { status: 201 })
  } catch (err) {
    return internalError(err)
  }
}
