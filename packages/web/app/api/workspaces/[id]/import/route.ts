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
import { commitWorkspaceFiles } from "@/lib/workspace-repo"
import { planFolderImport, IMPORT_MAX_FILES, IMPORT_MAX_REQUEST_BYTES } from "@/lib/workspace-import"
import { importStagedWorkspaceFiles } from "@/lib/server/workspace-assets"
import { UploadError, uploadErrorResponse } from "@/lib/server/file-uploads"

type Ctx = { params: Promise<{ id: string }> }
export const maxDuration = 300

interface ImportBody {
  /** The picked folder's own name, used in the commit message. */
  folder?: string
  files?: { relativePath?: string; contentBase64?: string }[]
  uploadFiles?: { relativePath: string; uploadId: string }[]
}

/**
 * POST /api/workspaces/:id/import — finalize workspace uploads.
 *
 * The browser stages bytes directly in private Storage and sends references.
 * Small files are committed together; larger files remain workspace assets.
 * Legacy base64 requests remain supported within the small request budget.
 *
 * The client plans the import too, so it can show what will be skipped before
 * anything is sent — but that preview is not trusted. The plan is recomputed
 * here from the paths actually received, and containment is checked against
 * this workspace afterwards, because every workspace lives in one repo and
 * containment is the only thing separating them.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params

  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: {
        slug: true,
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
  if (!workspace.path) return badRequest("This workspace is missing its path")

  try {
    const body: ImportBody = await req.json()
    if ("uploadFiles" in body) {
      return Response.json(await importStagedWorkspaceFiles({
        userId, token, workspaceId: id, base: workspace.path,
        branch: workspace.baseBranch ?? "main", slug: workspace.slug,
        folder: body.folder?.trim() || "files", incoming: body.uploadFiles,
      }))
    }
    const incoming = body.files
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return badRequest("Pick a folder with at least one file in it")
    }
    if (incoming.length > IMPORT_MAX_FILES * 4) {
      // Refuse the request outright rather than planning a folder that was
      // never going to fit; the plan would be mostly skip entries anyway.
      return badRequest(`That folder has too many files. Pick one with fewer than ${IMPORT_MAX_FILES}.`)
    }

    const content = new Map<string, string>()
    const entries: { relativePath: string; size: number }[] = []
    for (const f of incoming) {
      if (typeof f?.relativePath !== "string" || typeof f?.contentBase64 !== "string") {
        return badRequest("Each file needs a relativePath and contentBase64")
      }
      content.set(f.relativePath, f.contentBase64)
      // Size from the payload we actually hold, not from a number the client
      // sent alongside it — otherwise the caps police a claim rather than a file.
      entries.push({
        relativePath: f.relativePath,
        size: Buffer.from(f.contentBase64, "base64").byteLength,
      })
    }

    // Legacy inline requests retain the small request budget.
    const plan = planFolderImport(entries, workspace.path, IMPORT_MAX_REQUEST_BYTES)
    if (plan.files.length === 0) {
      return badRequest(
        `Nothing in that folder could be imported. ${plan.skipped.length} file(s) were skipped.`
      )
    }

    // Second line on containment. planFolderImport already refuses traversal,
    // but this is the check that ties the result to *this* workspace.
    const prefix = `${workspace.path}/`
    if (plan.files.some((f) => !f.path.startsWith(prefix))) {
      return forbidden("That file is not in this workspace")
    }

    const assets = await prisma.workspaceAsset.findMany({ where: { workspaceId: id }, select: { path: true } })
    if (plan.files.some(file => assets.some(asset => asset.path === file.path || asset.path.startsWith(`${file.path}/`) || file.path.startsWith(`${asset.path}/`)))) {
      return badRequest("An imported path conflicts with a Storage file. Use a different filename.")
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    const folder = body.folder?.trim() || "folder"

    const { commit, committed } = await commitWorkspaceFiles(
      token,
      plan.files.map((f) => ({ path: f.path, contentBase64: content.get(f.relativePath)! })),
      `Import ${folder} into ${workspace.slug} (${committedCount(plan.files.length)} via Shared Agents by ${user?.name ?? userId})`,
      workspace.baseBranch ?? "main"
    )

    return Response.json({ commit, committed, skipped: plan.skipped })
  } catch (err) {
    if (err instanceof UploadError) return uploadErrorResponse(err)
    const message = err instanceof Error ? err.message : "Import failed"
    if (message.includes("pushed while the import")) return badRequest(message)
    return internalError(err)
  }
}

function committedCount(n: number): string {
  return n === 1 ? "1 file" : `${n} files`
}
