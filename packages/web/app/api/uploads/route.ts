import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { validateUploadFile, MAX_UPLOAD_TOTAL_BYTES, type UploadScope } from "@/lib/upload-limits"
import { assertUploadAccess, UploadError, uploadErrorResponse } from "@/lib/server/file-uploads"
import { signedUploadUrl } from "@/lib/server/upload-storage"

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  try {
    const body = await req.json()
    const scope = body?.scope as UploadScope
    if (!scope || !["chat", "workspace"].includes(scope.kind) || typeof scope.id !== "string" || !scope.id || scope.id.length > 100) throw new UploadError("Invalid upload destination")
    try { validateUploadFile(body.name, body.size) }
    catch (error) { throw new UploadError((error as Error).message) }
    await assertUploadAccess(auth.userId, scope)
    // Bound unfinished uploads per user so abandoned picks cannot fill a free bucket.
    const objectPath = `${auth.userId}/${randomUUID()}`
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
    const uploadUrl = await signedUploadUrl(objectPath)
    const upload = await prisma.$transaction(async tx => {
      // Concurrent browser tabs must share the same unfinished-upload budget.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auth.userId}))`
      const unfinished = await tx.fileUpload.aggregate({
        where: { userId: auth.userId, consumedAt: null, expiresAt: { gt: new Date() } },
        _sum: { size: true }, _count: true,
      })
      if ((unfinished._sum.size || 0) + body.size > MAX_UPLOAD_TOTAL_BYTES || unfinished._count >= 200) throw new UploadError("You have too many unfinished uploads. Finish them or wait for cleanup.")
      return tx.fileUpload.create({ data: {
      userId: auth.userId, scope: scope.kind, scopeId: scope.id,
      name: body.name, size: body.size,
      contentType: typeof body.contentType === "string" ? body.contentType.slice(0, 200) : "application/octet-stream",
      objectPath, expiresAt,
      } })
    })
    return Response.json({ uploadId: upload.id, uploadUrl, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return uploadErrorResponse(error) }
}
