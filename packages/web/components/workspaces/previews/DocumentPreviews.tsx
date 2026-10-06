"use client"

import { useEffect } from "react"
import { formatFileSize } from "@/lib/file-preview"
import { usePreviewTask } from "./usePreviewTask"
import { PreviewFallback } from "./PreviewFallback"

function Loading() {
  return <div className="flex-1 animate-pulse bg-muted/30" aria-label="Loading preview" />
}

/** Word documents as clean HTML. mammoth keeps structure, DOMPurify strips anything active. */
export function DocxPreview({ path, bytes }: { path: string; bytes: Uint8Array }) {
  const { value: html, error } = usePreviewTask(async () => {
    const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([import("mammoth"), import("dompurify")])
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer as ArrayBuffer })
    return DOMPurify.sanitize(result.value)
  }, [bytes])
  if (error) return <PreviewFallback path={path} reason={`Couldn't read this document: ${error}`} />
  if (html === undefined) return <Loading />
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <article
        className="github-markdown mx-auto max-w-3xl p-8 [&_img]:max-w-full [&_table]:w-full"
        // Sanitised above; mammoth's output is semantic HTML only.
        dangerouslySetInnerHTML={{ __html: html || "<p><em>This document has no text.</em></p>" }}
      />
    </div>
  )
}

/** Slide text as an outline; layout is not reproduced. */
export function PptxPreview({ path, bytes }: { path: string; bytes: Uint8Array }) {
  const { value: slides, error } = usePreviewTask(async () => (await import("@/lib/file-preview/archive")).pptxOutline(bytes), [bytes])
  if (error) return <PreviewFallback path={path} reason={`Couldn't read this presentation: ${error}`} />
  if (!slides) return <Loading />
  if (!slides.length) return <PreviewFallback path={path} reason="This presentation has no slides with text." />
  return (
    <ol className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 p-6">
      {slides.map((slide) => (
        <li key={slide.number} className="mx-auto max-w-3xl rounded-lg border border-border bg-background p-5 shadow-sm">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Slide {slide.number}</p>
          {slide.paragraphs.length ? (
            slide.paragraphs.map((text, i) => (
              <p key={i} className={i === 0 ? "text-base font-semibold text-foreground" : "mt-1 text-sm text-foreground/80"}>{text}</p>
            ))
          ) : (
            <p className="text-sm italic text-muted-foreground">No text on this slide</p>
          )}
        </li>
      ))}
    </ol>
  )
}

export function ZipPreview({ path, bytes }: { path: string; bytes: Uint8Array }) {
  const { value: entries, error } = usePreviewTask(async () => (await import("@/lib/file-preview/archive")).listZip(bytes), [bytes])
  if (error) return <PreviewFallback path={path} reason={`Couldn't read this archive: ${error}`} />
  if (!entries) return <Loading />
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{entries.length} {entries.length === 1 ? "file" : "files"}</p>
      <ul className="font-mono text-[12px]">
        {entries.map((entry) => (
          <li key={entry.name} className="flex justify-between gap-4 border-b border-border/60 px-4 py-1.5">
            <span className="truncate">{entry.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatFileSize(entry.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SAMPLE = "The quick brown fox jumps over the lazy dog"

export function FontPreview({ path, bytes }: { path: string; bytes: Uint8Array }) {
  const family = `workspace-preview-${path.replace(/[^a-z0-9]/gi, "-")}`
  const { value: face, error } = usePreviewTask(async () => {
    const loaded = await new FontFace(family, bytes.slice().buffer as ArrayBuffer).load()
    document.fonts.add(loaded)
    return loaded
  }, [bytes, family])
  useEffect(() => () => { if (face) document.fonts.delete(face) }, [face])
  if (error) return <PreviewFallback path={path} reason="This browser can't load this font." />
  if (!face) return <Loading />
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto p-8" style={{ fontFamily: `"${family}"` }}>
      {[48, 32, 20, 14].map((size) => <p key={size} style={{ fontSize: size }} className="leading-tight text-foreground">{SAMPLE}</p>)}
      <p className="text-lg text-foreground">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />abcdefghijklmnopqrstuvwxyz<br />0123456789 !?&amp;$%@</p>
    </div>
  )
}

/**
 * HTML rendered in a frame with an empty sandbox: no scripts, no forms and an
 * opaque origin, so the page can neither run code nor reach the app's session.
 */
export function HtmlPreview({ path, html }: { path: string; html: string }) {
  return <iframe sandbox="" srcDoc={html} title={path.split("/").pop() ?? path} className="min-h-0 w-full flex-1 border-0 bg-white" />
}
