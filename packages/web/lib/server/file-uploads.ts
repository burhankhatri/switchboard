import { randomUUID } from "node:crypto"
import type { FileUpload } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { MAX_UPLOAD_TOTAL_BYTES, validateUploadIds, type UploadScope } from "@/lib/upload-limits"
import { deleteStoredFiles } from "./upload-storage"

export class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function assertUploadAccess(userId: string, scope: UploadScope) {
  if (scope.kind === "workspace") {
    const workspace = await prisma.workspace.findFirst({
      where: { id: scope.id, archived: false, members: { some: { userId } } }, select: { id: true },
    })
    if (!workspace) throw new UploadError("Join this workspace first", 403)
  } else {
    const chat = await prisma.chat.findFirst({ where: { id: scope.id, userId, archived: false }, select: { workspaceId: true } })
    if (!chat) throw new UploadError("Chat not found", 404)
    if (chat.workspaceId) await assertUploadAccess(userId, { kind: "workspace", id: chat.workspaceId })
  }
}

export interface ClaimedUploads { token: string; uploads: FileUpload[] }

export async function claimUploads(userId: string, scope: UploadScope, ids: unknown, maxFiles: number): Promise<ClaimedUploads> {
  validateUploadIds(ids, maxFiles)
  await assertUploadAccess(userId, scope)
  const token = randomUUID()
  if (!ids.length) return { token, uploads: [] }
  const now = new Date()
  const uploads = await prisma.$transaction(async tx => {
    const where = {
      id: { in: ids }, userId, scope: scope.kind, scopeId: scope.id,
      consumedAt: null, expiresAt: { gt: now },
      OR: [{ claimUntil: null }, { claimUntil: { lt: now } }],
    }
    const claimed = await tx.fileUpload.updateMany({ where, data: { claimToken: token, claimUntil: new Date(now.getTime() + 10 * 60_000) } })
    if (claimed.count !== ids.length) throw new UploadError("An upload is expired, already used, busy, or belongs to another destination. Reattach the file and try again.")
    const rows = await tx.fileUpload.findMany({ where: { id: { in: ids }, claimToken: token } })
    if (rows.reduce((sum, row) => sum + row.size, 0) > MAX_UPLOAD_TOTAL_BYTES) throw new UploadError("Uploads must total 100 MB or less")
    return rows
  })
  return { token, uploads: ids.map(id => uploads.find(row => row.id === id)!) }
}

export async function releaseUploads(claim: ClaimedUploads) {
  if (!claim.uploads.length) return
  await prisma.fileUpload.updateMany({
    where: { id: { in: claim.uploads.map(row => row.id) }, claimToken: claim.token },
    data: { claimToken: null, claimUntil: null },
  })
}

export async function consumeUploads(claim: ClaimedUploads) {
  if (!claim.uploads.length) return
  await prisma.fileUpload.updateMany({
    where: { id: { in: claim.uploads.map(row => row.id) }, claimToken: claim.token },
    data: { consumedAt: new Date(), claimToken: null, claimUntil: null },
  })
  // Keep consumed records until their original expiry: a still-valid signed
  // upload token could recreate a deleted object, which cleanup must find.
  try { await deleteStoredFiles(claim.uploads.map(row => row.objectPath)) }
  catch { console.warn("[uploads] Temporary deletion deferred to cleanup") }
}

export async function cleanupExpiredUploads(): Promise<number> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0
  const now = new Date()
  const candidates = await prisma.fileUpload.findMany({
    where: {
      asset: null,
      AND: [
        { OR: [{ expiresAt: { lt: now } }, { expiresAt: null, createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } }] },
        { OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] },
      ],
    }, orderBy: { createdAt: "asc" }, take: 50,
  })
  if (!candidates.length) return 0
  // Expired records cannot be claimed or retained, so removal cannot race a run.
  await deleteStoredFiles(candidates.map(row => row.objectPath))
  const deleted = await prisma.fileUpload.deleteMany({ where: { id: { in: candidates.map(row => row.id) }, asset: null } })
  return deleted.count
}

export function uploadErrorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, {
    status: error instanceof UploadError ? error.status : 502,
  })
}
