import { prisma } from "@/lib/db/prisma"
import { MAX_GIT_FILE_BYTES } from "@/lib/upload-limits"
import { IMPORT_MAX_FILES, planFolderImport } from "@/lib/workspace-import"
import { commitWorkspaceFiles, listWorkspaceFiles, type FileToCommit } from "@/lib/workspace-repo"
import { claimUploads, consumeUploads, releaseUploads, UploadError } from "./file-uploads"
import { downloadStoredFile, verifyStoredSize, deleteStoredFiles } from "./upload-storage"

export async function importStagedWorkspaceFiles(options: {
  userId: string; token: string; workspaceId: string; base: string;
  branch: string; slug: string; folder: string; incoming: unknown;
}) {
  const { incoming, userId, token, workspaceId, base, branch } = options
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > IMPORT_MAX_FILES || incoming.some(f => !f || typeof f.relativePath !== "string" || typeof f.uploadId !== "string")) throw new UploadError("Invalid workspace upload references")
  if (new Set(incoming.map(f => f.relativePath)).size !== incoming.length) throw new UploadError("Duplicate file paths")
  const claim = await claimUploads(userId, { kind: "workspace", id: workspaceId }, incoming.map(f => f.uploadId), IMPORT_MAX_FILES)
  try {
    const byPath = new Map(incoming.map((f, i) => [f.relativePath as string, claim.uploads[i]]))
    const plan = planFolderImport(incoming.map((f, i) => ({ relativePath: f.relativePath, size: claim.uploads[i].size })), base)
    if (!plan.files.length) throw new UploadError("Nothing could be imported")
    const [gitFiles, existingAssets] = await Promise.all([
      listWorkspaceFiles(token, base, branch),
      prisma.workspaceAsset.findMany({ where: { workspaceId }, include: { upload: true } }),
    ])
    const gitPaths = new Set(gitFiles.workspace.map(f => f.path))
    const assetPaths = new Set(existingAssets.map(f => f.path))
    for (const file of plan.files) {
      if ((file.size > MAX_GIT_FILE_BYTES && gitPaths.has(file.path)) || (file.size <= MAX_GIT_FILE_BYTES && assetPaths.has(file.path))) {
        throw new UploadError(`"${file.relativePath}" already exists in a different file store. Use a different filename.`)
      }
      // A file must not become the parent directory of another file.
      const otherPaths = [...gitPaths, ...assetPaths, ...plan.files.map(f => f.path)]
      if (otherPaths.some(p => p !== file.path && (p.startsWith(`${file.path}/`) || file.path.startsWith(`${p}/`)))) throw new UploadError(`"${file.relativePath}" conflicts with a file or folder`)
    }
    for (const file of plan.files) await verifyStoredSize(byPath.get(file.relativePath)!.objectPath, file.size)
    const small: FileToCommit[] = []
    const retained = plan.files.filter(file => file.size > MAX_GIT_FILE_BYTES)
    for (const file of plan.files.filter(file => file.size <= MAX_GIT_FILE_BYTES)) {
      const upload = byPath.get(file.relativePath)!
      const bytes = await downloadStoredFile(upload.objectPath, file.size)
      small.push({ path: file.path, contentBase64: bytes.toString("base64") })
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    let commit: string | null = null
    if (small.length) {
      const result = await commitWorkspaceFiles(token, small, `Import ${options.folder.slice(0, 200)} into ${options.slug} (via Shared Agents by ${user?.name ?? userId})`, branch)
      commit = result.commit
    }
    const superseded = existingAssets.filter(asset => retained.some(f => f.path === asset.path)).map(asset => asset.upload)
    await prisma.$transaction(async tx => {
      for (const file of retained) {
        const upload = byPath.get(file.relativePath)!
        await tx.workspaceAsset.upsert({
          where: { workspaceId_path: { workspaceId, path: file.path } },
          create: { workspaceId, path: file.path, uploadId: upload.id },
          update: { uploadId: upload.id },
        })
        await tx.fileUpload.update({ where: { id: upload.id }, data: { expiresAt: null, claimToken: null, claimUntil: null } })
      }
      for (const upload of superseded) {
        await tx.fileUpload.update({ where: { id: upload.id }, data: { consumedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } })
      }
    })
    const temporary = claim.uploads.filter(upload => !retained.some(f => byPath.get(f.relativePath)!.id === upload.id))
    try { await consumeUploads({ token: claim.token, uploads: temporary }) }
    catch { console.warn("[uploads] Import succeeded; temporary cleanup deferred") }
    try { await deleteStoredFiles(superseded.map(upload => upload.objectPath)) }
    catch { console.warn("[uploads] Replaced asset deletion deferred to cleanup") }
    return { commit, committed: plan.files.length, retained: retained.length, skipped: plan.skipped }
  } finally {
    try { await releaseUploads(claim) }
    catch { console.warn("[uploads] Import claim release deferred until lease expiry") }
  }
}
