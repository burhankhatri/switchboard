"use client"

import { useMemo } from "react"
import type { PreviewKind } from "@/lib/file-kind"
import { MarkdownPreview } from "@/lib/file-preview"
import { parseInWorker } from "@/lib/file-preview/parse-in-worker"
import { SpreadsheetPreview } from "./SpreadsheetPreview"
import { MediaPreview } from "./MediaPreview"
import { DocxPreview, FontPreview, HtmlPreview, PptxPreview, ZipPreview } from "./DocumentPreviews"
import { PreviewFallback } from "./PreviewFallback"
import { usePreviewTask } from "./usePreviewTask"

/** Bytes from the raw route, or the editor's text when the file is already open as text. */
export type PreviewSource = { bytes: Uint8Array } | { text: string }

/** A read-only rendering of one workspace file, chosen by its preview kind. */
export function FilePreview({ kind, path, source }: { kind: Exclude<PreviewKind, "none">; path: string; source: PreviewSource }) {
  const bytes = useMemo(() => ("bytes" in source ? source.bytes : new TextEncoder().encode(source.text)), [source])
  const text = useMemo(() => ("text" in source ? source.text : new TextDecoder().decode(source.bytes)), [source])

  switch (kind) {
    case "spreadsheet":
    case "csv":
      return <SheetsFromBytes kind={kind} path={path} bytes={bytes} />
    case "markdown":
      return <MarkdownPreview content={text} className="min-h-0 flex-1" />
    case "html":
      return <HtmlPreview path={path} html={text} />
    case "svg":
    case "image":
    case "pdf":
    case "audio":
    case "video":
      return <MediaPreview kind={kind} path={path} bytes={bytes} />
    case "docx":
      return <DocxPreview path={path} bytes={bytes} />
    case "pptx":
      return <PptxPreview path={path} bytes={bytes} />
    case "zip":
      return <ZipPreview path={path} bytes={bytes} />
    case "font":
      return <FontPreview path={path} bytes={bytes} />
  }
}

function SheetsFromBytes({ kind, path, bytes }: { kind: "spreadsheet" | "csv"; path: string; bytes: Uint8Array }) {
  const { value: sheets, error } = usePreviewTask((signal) => parseInWorker({ bytes, name: path, kind }, signal), [bytes, path, kind])
  if (error) return <PreviewFallback path={path} reason={`Couldn't read this spreadsheet: ${error}`} />
  if (!sheets) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <span className="animate-pulse">Reading workbook…</span>
      </div>
    )
  }
  return <SpreadsheetPreview sheets={sheets} />
}
