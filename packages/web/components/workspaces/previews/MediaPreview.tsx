"use client"

import { useEffect, useMemo, useState } from "react"
import { PdfFullPreview } from "@/lib/file-preview"
import { previewMime } from "@/lib/file-preview/preview-bytes"
import { PreviewFallback } from "./PreviewFallback"

type MediaKind = "image" | "svg" | "pdf" | "audio" | "video"

/**
 * Formats the browser renders itself, from an object URL typed by the allowlist.
 * SVG goes through <img>, where its scripts never run.
 */
export function MediaPreview({ kind, path, bytes }: { kind: MediaKind; path: string; bytes: Uint8Array }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes as BlobPart], { type: previewMime(path) })), [bytes, path])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [failed, setFailed] = useState(false)
  const name = path.split("/").pop() ?? path

  if (failed) return <PreviewFallback path={path} reason="This browser can't display this file." />
  if (kind === "pdf") return <PdfFullPreview src={url} title={name} height="100%" className="min-h-0 flex-1" />
  if (kind === "audio") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <audio src={url} controls onError={() => setFailed(true)} className="w-full max-w-lg" />
      </div>
    )
  }
  if (kind === "video") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
        <video src={url} controls onError={() => setFailed(true)} className="max-h-full max-w-full" />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- an object URL, not an optimisable asset */}
      <img src={url} alt={name} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain shadow-sm" />
    </div>
  )
}
