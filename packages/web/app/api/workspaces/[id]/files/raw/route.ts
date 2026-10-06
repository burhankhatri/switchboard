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
import { readWorkspaceFileRaw } from "@/lib/workspace-repo"
import { signedDownloadUrl } from "@/lib/server/upload-storage"

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/:id/files/raw?path=... -> one file's bytes, for previews
 * and downloads.
 *
 * Members only, with the same containment rule as the file read. The bytes are
 * whatever a member uploaded, so the response is always an opaque attachment:
 * opening this URL directly must never render an uploaded HTML or SVG file as a
 * page on the app's origin. The viewer picks the real type from an allowlist.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params
  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: { path: true, baseBranch: true, members: { select: { userId: true } } },
    }),
  ])
  if (isGitHubAuthError(auth)) return auth
  if (!workspace) return notFound("Workspace not found")
  if (!workspace.members.some((m) => m.userId === auth.userId)) return forbidden("Join this workspace first")

  const path = new URL(req.url).searchParams.get("path")
  if (!path) return badRequest("path is required")
  if (!path.startsWith(`${workspace.path}/`) && !path.startsWith(".claude/")) {
    return forbidden("That file is not in this workspace")
  }
  if (path.includes("\\") || /[\x00-\x1f\x7f]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    return badRequest("Invalid path")
  }

  try {
    const asset = await prisma.workspaceAsset.findUnique({
      where: { workspaceId_path: { workspaceId: id, path } },
      include: { upload: true },
    })
    // Retained assets can be 25 MiB; sending them through this function would
    // hit Vercel's response limits, so the browser fetches them from Storage.
    if (asset) {
      return new Response(null, {
        status: 302,
        headers: { Location: await signedDownloadUrl(asset.upload.objectPath, asset.upload.name), "Cache-Control": "no-store" },
      })
    }

    const file = await readWorkspaceFileRaw(auth.token, path, workspace.baseBranch)
    const name = path.split("/").pop() ?? "file"
    return new Response(file.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
        ...(file.size !== null ? { "Content-Length": String(file.size) } : {}),
      },
    })
  } catch (err) {
    if ((err as { status?: number }).status === 404) return notFound("File not found. Refresh the file list.")
    return internalError(err)
  }
}
