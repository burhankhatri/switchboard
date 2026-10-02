import { validateUploadFile, type UploadScope } from "./upload-limits"

interface StagedFile { uploadId: string; expiresAt: number }
const staged = new WeakMap<File, Map<string, StagedFile>>()

/** Reuse an already uploaded File on retry without paying for another transfer. */
export async function stageFile(file: File, scope: UploadScope, onProgress?: (bytes: number) => void): Promise<string> {
  validateUploadFile(file.name, file.size)
  const key = `${scope.kind}:${scope.id}`
  const existing = staged.get(file)?.get(key)
  if (existing && existing.expiresAt > Date.now() + 60_000) {
    onProgress?.(file.size)
    return existing.uploadId
  }
  const response = await fetch("/api/uploads", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, name: file.name, size: file.size, contentType: file.type }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || "Could not authorize file upload")
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", data.uploadUrl)
    xhr.timeout = 5 * 60_000
    xhr.setRequestHeader("x-upsert", "false")
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.upload.onprogress = event => onProgress?.(Math.min(event.loaded, file.size))
    xhr.onerror = () => reject(new Error(`Could not upload ${file.name}. Check your connection and try again.`))
    xhr.ontimeout = () => reject(new Error(`Upload timed out for ${file.name}. Try again.`))
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed for ${file.name} (HTTP ${xhr.status})`))
    xhr.send(file)
  })
  const cache = staged.get(file) || new Map<string, StagedFile>()
  cache.set(key, { uploadId: data.uploadId, expiresAt: Date.parse(data.expiresAt) })
  staged.set(file, cache)
  onProgress?.(file.size)
  return data.uploadId
}

export function forgetStagedFile(file: File, scope: UploadScope) {
  staged.get(file)?.delete(`${scope.kind}:${scope.id}`)
}
