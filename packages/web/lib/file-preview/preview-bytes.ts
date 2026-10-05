/** The Storage per-file limit; a Git file larger than this is offered as a download only. */
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024

/**
 * Types an object URL may carry. Object URLs share the app's origin, so a file
 * typed as HTML or XML here would run its scripts with the member's session —
 * anything not listed stays an opaque octet stream.
 */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
}

export function previewMime(path: string): string {
  const name = path.split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  return (dot > 0 && MIME[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream"
}

/** Fetch a file's bytes for a preview, refusing anything over the cap before downloading it. */
export async function fetchPreviewBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, cache: "no-store" })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string })
    throw new Error(body.error ?? `Could not load this file (HTTP ${response.status})`)
  }
  if (Number(response.headers.get("content-length")) > MAX_PREVIEW_BYTES) {
    await response.body?.cancel()
    throw new Error("This file is too large to preview. Download it to open it.")
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error("This file is too large to preview. Download it to open it.")
  return bytes
}
