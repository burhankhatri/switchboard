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
  deleteWorkspaceFile,
} from "@/lib/workspace-repo"
import { signedDownloadUrl, deleteStoredFiles } from "@/lib/server/upload-storage"

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params
  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({ where: { id, archived: false }, select: { slug: true, path: true, baseBranch: true, members: { select: { userId: true } } } }),
  ])
  if (isGitHubAuthError(auth)) return auth
  if (!workspace) return notFound("Workspace not found")
  if (!workspace.members.some(member => member.userId === auth.userId)) return forbidden("Join this workspace first")
  let body: { path?: unknown; sha?: unknown }
  try { body = await req.json() } catch { return badRequest("Invalid deletion request") }
  if (!body || typeof body.path !== "string" || typeof body.sha !== "string" || !body.sha || body.sha.length > 100) return badRequest("path and file version are required")
  const path = body.path
  if (!workspace.path || !path.startsWith(`${workspace.path}/`)) return forbidden("That file is not in this workspace")
  if (path.length > 1024 || path.includes("\\") || /[\x00-\x1f\x7f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) return badRequest("Invalid path")
  try {
    const asset = await prisma.workspaceAsset.findUnique({ where: { workspaceId_path: { workspaceId: id, path } }, include: { upload: true } })
    if (asset) {
      if (asset.uploadId !== body.sha) return Response.json({ error: "This file changed. Reopen Delete to confirm the latest version." }, { status: 409 })
      // Keep the reference on Storage failure so the user can retry deletion.
      await deleteStoredFiles([asset.upload.objectPath])
      const removed = await prisma.$transaction(async tx => {
        const result = await tx.workspaceAsset.deleteMany({ where: { id: asset.id, uploadId: asset.uploadId } })
        if (result.count) await tx.fileUpload.update({ where: { id: asset.uploadId }, data: { consumedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } })
        return result.count
      })
      if (!removed) return Response.json({ error: "This file changed. Refresh the file list." }, { status: 409 })
    } else {
      const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } })
      await deleteWorkspaceFile(auth.token, path, body.sha, `Delete ${path.split("/").pop()} from ${workspace.slug} (via Shared Agents by ${user?.name ?? auth.userId})`, workspace.baseBranch ?? "main")
    }
    return Response.json({ deleted: true, path })
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 409 || status === 404) return Response.json({ error: error instanceof Error ? error.message : "Delete failed" }, { status })
    return internalError(error)
  }
}

/**
 * GET /api/workspaces/:id/files          -> the file tree a run would see
 * GET /api/workspaces/:id/files?path=... -> one file's contents
 *
 * Members only. Reads come from the repo rather than a sandbox so the workspace
 * is browsable without spinning one up, and so what you read is what the next
 * run will clone.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params

  // Auth and the workspace row were resolved one after the other, which meant
  // two serial round trips to a cross-region database before any real work
  // started. The workspace lookup does not depend on the auth result — only the
  // membership filter does, and that is applied below — so they overlap.
  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: {
        path: true,
        baseBranch: true,
        members: { select: { userId: true } },
      },
    }),
  ])
  if (isGitHubAuthError(auth)) return auth
  const { userId, token } = auth

  if (!workspace) return notFound("Workspace not found")
  if (!workspace.members.some((m) => m.userId === userId)) {
    return forbidden("Join this workspace first")
  }

  const path = req.nextUrl.searchParams.get("path")

  try {
    if (!path) {
      const files = await listWorkspaceFiles(token, workspace.path, workspace.baseBranch)
      const assets = await prisma.workspaceAsset.findMany({ where: { workspaceId: id }, include: { upload: true } })
      files.workspace.push(...assets.map(asset => ({ path: asset.path, name: asset.path.slice(workspace.path.length + 1), size: asset.upload.size })))
      files.workspace.sort((a, b) => a.name.localeCompare(b.name))
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

    const asset = await prisma.workspaceAsset.findUnique({ where: { workspaceId_path: { workspaceId: id, path } }, include: { upload: true } })
    if (asset) {
      return Response.json({ path, content: "", truncated: true, sha: asset.uploadId, storageAsset: true,
        downloadUrl: await signedDownloadUrl(asset.upload.objectPath, asset.upload.name), size: asset.upload.size,
      }, { headers: { "Cache-Control": "no-store" } })
    }
    const file = await readWorkspaceFile(token, path, workspace.baseBranch)
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
  const { id } = await params

  // Same overlap as GET. The user row is only wanted for the commit author's
  // display name, so it rides along rather than adding a fourth serial hop.
  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: {
        slug: true,
        path: true,
        members: { select: { userId: true } },
      },
    }),
  ])
  if (isGitHubAuthError(auth)) return auth
  const { userId, token } = auth

  if (!workspace) return notFound("Workspace not found")
  if (!workspace.members.some((m) => m.userId === userId)) {
    return forbidden("Join this workspace first")
  }

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

    if (await prisma.workspaceAsset.findUnique({ where: { workspaceId_path: { workspaceId: id, path } } })) {
      return badRequest("This file is available for download. Upload a replacement to update it.")
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })

    const { sha } = await writeWorkspaceFile(
      token,
      path,
      body.content,
      body.sha ?? "",
      `Update ${path.split("/").pop()} in ${workspace.slug} (via Shared Agents by ${user?.name ?? userId})`
    )
    return Response.json({ path, sha })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed"
    if (message.includes("changed since you opened")) return badRequest(message)
    return internalError(err)
  }
}
