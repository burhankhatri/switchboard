import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireGitHubAuth,
  isGitHubAuthError,
  notFound,
  forbidden,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/lib/workspace-repo"

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/:id/files          -> the file tree a run would see
 * GET /api/workspaces/:id/files?path=... -> one file's contents
 *
 * Members only. Reads come from the repo rather than a sandbox so the workspace
 * is browsable without spinning one up, and so what you read is what the next
 * run will clone.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth
  const { userId, token } = auth
  const { id } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: {
      path: true,
      baseBranch: true,
      members: { where: { userId }, select: { role: true } },
    },
  })
  if (!workspace) return notFound("Workspace not found")
  if (workspace.members.length === 0) return forbidden("Join this workspace first")

  const path = req.nextUrl.searchParams.get("path")

  try {
    if (!path) {
      const files = await listWorkspaceFiles(token, workspace.path, workspace.baseBranch)
      return Response.json(files)
    }

    // Containment check against THIS workspace. Without it, a member of any
    // workspace could read any other workspace's files through this route by
    // passing its path — every workspace lives in the same repo.
    const inWorkspace = path.startsWith(`${workspace.path}/`)
    const inShared = path.startsWith(".claude/")
    if (!inWorkspace && !inShared) {
      return forbidden("That file is not in this workspace")
    }
    if (path.includes("..")) return badRequest("Invalid path")

    const file = await readWorkspaceFile(token, path)
    return Response.json({ path, ...file })
  } catch (err) {
    return internalError(err)
  }
}

interface SaveBody {
  path?: string
  content?: string
  /** Blob sha the editor opened; GitHub rejects the write if it has moved on. */
  sha?: string
}

/**
 * PUT /api/workspaces/:id/files — save a file by committing it.
 *
 * Any member may edit. That is the product ("a skill someone builds becomes
 * available to everyone"), and it is why the commit carries the editor's
 * identity: every change to what an agent does is attributable in git history.
 */
export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth
  const { userId, token } = auth
  const { id } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: {
      slug: true,
      path: true,
      members: { where: { userId }, select: { role: true } },
    },
  })
  if (!workspace) return notFound("Workspace not found")
  if (workspace.members.length === 0) return forbidden("Join this workspace first")

  try {
    const body: SaveBody = await req.json()
    const path = body.path
    if (!path || typeof body.content !== "string") {
      return badRequest("path and content are required")
    }
    // Same containment rule as reading — every workspace shares one repo, so
    // without this a member could write into another workspace's folder.
    const inWorkspace = path.startsWith(`${workspace.path}/`)
    const inShared = path.startsWith(".claude/")
    if (!inWorkspace && !inShared) return forbidden("That file is not in this workspace")
    if (path.includes("..")) return badRequest("Invalid path")

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    const { sha } = await writeWorkspaceFile(
      token,
      path,
      body.content,
      body.sha ?? "",
      `Update ${path.split("/").pop()} in ${workspace.slug} (via Switchboard by ${user?.name ?? userId})`
    )
    return Response.json({ path, sha })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed"
    if (message.includes("changed since you opened")) return badRequest(message)
    return internalError(err)
  }
}
