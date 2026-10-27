"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X, Check, ChevronRight, RefreshCw, Download, Eye, Pencil } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import {
  clearDraft,
  readCachedFile,
  readDraft,
  writeCachedFile,
  writeDraft,
} from "@/lib/workspace-file-cache"
import { cursorPosition, lineCount } from "@/lib/editor-position"
import { workspaceFileQueryOptions, type FilePayload } from "@/lib/workspace-file-query"
import { isBinaryFile, previewKind, type PreviewKind } from "@/lib/file-kind"
import { fetchPreviewBytes } from "@/lib/file-preview/preview-bytes"
import { SelectionActions } from "./SelectionActions"
import { FileIcon } from "./files/FileIcon"
import { FilePreview } from "./previews/FilePreview"
import { PreviewFallback } from "./previews/PreviewFallback"
import { cn } from "@/lib/utils"


const LANGUAGE: Record<string, string> = {
  md: "Markdown", mdx: "MDX", py: "Python", ts: "TypeScript", tsx: "TypeScript JSX",
  js: "JavaScript", jsx: "JavaScript JSX", json: "JSON", yaml: "YAML", yml: "YAML",
  toml: "TOML", csv: "CSV", tsv: "TSV", sh: "Shell", sql: "SQL", html: "HTML",
  css: "CSS", txt: "Plain Text",
}

const KIND_LABEL: Partial<Record<PreviewKind, string>> = {
  spreadsheet: "Spreadsheet", pdf: "PDF", image: "Image", audio: "Audio", video: "Video",
  docx: "Word document", pptx: "Presentation", zip: "Zip archive", font: "Font",
}

/** Text whose rendered form is what people usually want to read; Edit shows the source. */
const RENDERED_TEXT = new Set<PreviewKind>(["markdown", "csv", "html", "svg"])

function languageOf(path: string): string {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : ""
  return LANGUAGE[ext] ?? (ext ? ext.toUpperCase() : "Plain Text")
}

/**
 * Edit a workspace file.
 *
 * Saving commits to the workspaces repo, so the repo stays the single source of
 * truth and an edit here is exactly what the next run clones. The blob sha the
 * editor opened is sent back with the save: if someone else changed the file
 * meanwhile, GitHub rejects it and we surface a conflict instead of silently
 * overwriting them.
 *
 * The editor is local-first. Opening a file paints from localStorage and
 * revalidates behind that, and Save returns immediately while the commit
 * happens in the background — a commit is a network round trip to GitHub, and
 * there is no reason to make someone watch a spinner for it. The cost of that
 * choice is that a rejected save surfaces a moment after it looked fine, which
 * is why a failure restores the unsaved state rather than just logging.
 */
export function WorkspaceFileViewer() {
  const { activeWorkspace, openFile, closeOpenFile } = useWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<"preview" | "edit">("preview")
  // Selection is tracked as offsets rather than the text itself, so applying a
  // rewrite can splice it back into exactly the range that was highlighted.
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [caret, setCaret] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)
  const qc = useQueryClient()
  const wsId = activeWorkspace?.id ?? ""

  // Seeded synchronously so the first paint already has content for any file
  // opened before. Recomputed per file, not per render.
  const cached = useMemo(
    () => (wsId && openFile ? readCachedFile(wsId, openFile) : null),
    [wsId, openFile]
  )
  const { data, isPending, isFetching, error } = useQuery(
    workspaceFileQueryOptions({
      wsId,
      path: openFile,
      cached,
      fetchFile: async () => {
        const r = await fetch(`/api/workspaces/${wsId}/files?path=${encodeURIComponent(openFile!)}`)
        if (!r.ok) throw new Error(String(r.status))
        const file = (await r.json()) as FilePayload
        // A binary file's "content" is decoded noise; caching it would only spend
        // localStorage quota on something the editor never shows.
        if (!file.storageAsset && !isBinaryFile(openFile!)) writeCachedFile(wsId, openFile!, {
          content: file.content,
          sha: file.sha,
          truncated: file.truncated,
        })
        return file
      },
    })
  )

  // Restore whatever was being typed when this file was last open. Keyed on the
  // file alone — reacting to the sha as well would discard an in-flight edit the
  // moment a background revalidation landed.
  useEffect(() => {
    if (!wsId || !openFile) {
      setDraft(null)
      return
    }
    const stored = readDraft(wsId, openFile)
    setDraft(stored?.content ?? null)
    setSaved(false)
    setMode("preview")
  }, [wsId, openFile])

  // Opening a file as a binary used to mean an icon card. Every format a
  // browser can render now previews, so these are decided before the early
  // return: the bytes query below is a hook and must run on every render.
  const kind: PreviewKind = openFile ? previewKind(openFile) : "none"
  // Opening a PDF as text shows noise, and saving it would commit that noise
  // over the real file — so binary files are shown, never edited.
  const binary = openFile ? isBinaryFile(openFile) : false
  const rendersText = !binary && RENDERED_TEXT.has(kind)
  const showPreview = !!data && (binary || !!data.storageAsset || (rendersText && mode === "preview"))
  // Text the editor already holds previews from that text, unsaved edits
  // included; everything else needs the file's real bytes.
  const needsBytes = showPreview && kind !== "none" && (binary || !!data?.storageAsset || !!data?.truncated)
  const rawUrl = openFile ? `/api/workspaces/${wsId}/files/raw?path=${encodeURIComponent(openFile)}` : ""
  const bytes = useQuery({
    queryKey: ["workspace-file-bytes", wsId, openFile, data?.sha],
    queryFn: ({ signal }) => fetchPreviewBytes(rawUrl, signal),
    enabled: needsBytes,
    staleTime: Infinity,
    // Workbooks are megabytes; don't hold every one ever opened.
    gcTime: 5 * 60_000,
    retry: false,
  })

  const save = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/workspaces/${wsId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openFile, content, sha: data?.sha }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed")
      return res.json() as Promise<{ path: string; sha: string }>
    },
    // Confirm to the user now. The commit is a background detail.
    onMutate: (content: string) => {
      setSaved(true)
      if (wsId && openFile) {
        writeCachedFile(wsId, openFile, {
          content,
          sha: data?.sha ?? "",
          truncated: false,
        })
      }
    },
    onSuccess: (res, content) => {
      if (!wsId || !openFile) return
      // Committed: the draft IS the server's content now, so it stops being
      // unsaved work and the local copy is dropped.
      clearDraft(wsId, openFile)
      setDraft(null)
      qc.setQueryData<FilePayload>(["workspace-file", wsId, openFile], (prev) =>
        prev ? { ...prev, content, sha: res.sha } : prev
      )
      writeCachedFile(wsId, openFile, { content, sha: res.sha, truncated: false })
      qc.invalidateQueries({ queryKey: ["workspace-files", wsId] })
    },
    // The draft stays on disk, so a rejected save never costs the edit.
    onError: () => setSaved(false),
  })

  if (!openFile) return null
  const value = draft ?? data?.content ?? ""
  const dirty = draft !== null && draft !== data?.content

  const selected = range ? value.slice(range.start, range.end) : ""

  const syncSelection = () => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    setCaret(end)
    setRange(start === end ? null : { start, end })
  }

  /** Splice an accepted rewrite back over the range it was made from. */
  const applyRewrite = (replacement: string) => {
    if (!range) return
    onEdit(value.slice(0, range.start) + replacement + value.slice(range.end))
    setRange(null)
  }

  const onEdit = (next: string) => {
    setDraft(next)
    setSaved(false)
    // Every keystroke, not debounced: this is the only copy of unsaved work,
    // and a debounce is exactly the window in which a crash loses it.
    if (wsId && openFile) writeDraft(wsId, openFile, { content: next, baseSha: data?.sha ?? "" })
  }

  const fileName = openFile.split("/").pop() ?? openFile
  const base = activeWorkspace?.path
  const inside = base && openFile.startsWith(`${base}/`) ? openFile.slice(base.length + 1) : openFile
  const crumbs = [activeWorkspace?.name ?? "Workspace", ...inside.split("/")]
  const showEditor = !!data && !binary && !data.storageAsset && !showPreview
  const position = cursorPosition(value, Math.min(caret, value.length))
  // Computed inline, not memoised: this runs after the early return above, and
  // a hook here would change the hook order whenever a file opens or closes.
  const gutter = Array.from({ length: lineCount(value) }, (_, i) => i + 1).join("\n")

  return (
    // Laid out like an editor rather than a card: edge to edge, a tab for the
    // file, the path as a breadcrumb, a line-number gutter and a status bar.
    <div className="flex h-full w-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-muted/40">
        <div className="-mb-px flex min-w-0 max-w-[60%] items-center gap-2 border-r border-border bg-background px-3 text-[13px]">
          <FileIcon path={openFile} />
          <span className="truncate">{fileName}</span>
          {dirty ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-foreground/60" title="Unsaved changes" />
          ) : null}
          <button
            onClick={() => void closeOpenFile()}
            className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            aria-label="Close file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3">
          {/* Revalidation is ambient, not a wait — it must never look like one. */}
          {isFetching && !isPending && (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground/60" aria-label="Syncing" />
          )}
          {saved && !dirty && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3" /> {save.isPending ? "Saved locally" : "Committed"}
            </span>
          )}
          {rendersText && data && !data.storageAsset && (
            <div role="group" aria-label="View" className="flex rounded-md border border-border p-0.5">
              {(["preview", "edit"] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 text-xs cursor-pointer",
                    mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "preview" ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                  {m === "preview" ? "Preview" : "Edit"}
                </button>
              ))}
            </div>
          )}
          {data && (
            <a
              href={rawUrl}
              download={fileName}
              aria-label="Download file"
              title="Download file"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
          {!binary && !data?.storageAsset && (
            <button
              onClick={() => save.mutate(value)}
              disabled={!dirty || data?.truncated}
              title={data?.truncated ? "This file is too large to edit here" : "Commit to the workspace repo"}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer",
                "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
              )}
            >
              Save
            </button>
          )}
        </div>
      </div>

      <nav
        aria-label="File path"
        className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-border px-3 text-[12px] text-muted-foreground"
      >
        {crumbs.map((c, i) => (
          <Fragment key={`${i}-${c}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
            <span className={cn("truncate", i === crumbs.length - 1 && "text-foreground")}>{c}</span>
          </Fragment>
        ))}
      </nav>

      {/* Only a file never opened before can show a loading state. */}
      {isPending && <div className="flex-1 animate-pulse bg-muted/30" aria-label="Loading" />}
      {error && !data && <p className="p-6 text-sm text-muted-foreground">Could not open this file.</p>}
      {save.error && (
        <p className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {(save.error as Error).message}
        </p>
      )}

      {showPreview && data && (
        kind === "none" ? (
          <PreviewFallback
            path={openFile}
            reason={`${data.storageAsset ? "Available" : "Stored in the workspace and available"} to the agent on its next run. This file type can't be previewed here — download it to open it.`}
          />
        ) : !needsBytes ? (
          <FilePreview kind={kind} path={openFile} source={{ text: value }} />
        ) : bytes.data ? (
          <FilePreview kind={kind} path={openFile} source={{ bytes: bytes.data }} />
        ) : bytes.error ? (
          <PreviewFallback path={openFile} reason={(bytes.error as Error).message} />
        ) : (
          <div className="flex-1 animate-pulse bg-muted/30" aria-label="Loading preview" />
        )
      )}

      {showEditor && data && (
        // min-h-0 is load-bearing: without it the textarea's own content height
        // becomes the flex floor and the editor stops shrinking to its pane.
        <div className="flex min-h-0 flex-1">
          <pre
            ref={gutterRef}
            aria-hidden="true"
            className="m-0 shrink-0 select-none overflow-hidden border-r border-border bg-muted/20 py-3 pb-8 pl-4 pr-3 text-right font-mono text-[12px] leading-6 text-muted-foreground/70"
          >
            {gutter}
          </pre>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onEdit(e.target.value)}
            onSelect={syncSelection}
            onKeyUp={syncSelection}
            onMouseUp={syncSelection}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            spellCheck={false}
            wrap="off"
            readOnly={data.truncated}
            aria-label={`Contents of ${fileName}`}
            style={{ tabSize: 2 }}
            className="min-h-0 min-w-0 flex-1 resize-none whitespace-pre bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-foreground outline-none"
          />
        </div>
      )}

      {showEditor && wsId && (
        <div className="shrink-0 px-3 empty:hidden">
          <SelectionActions
            workspaceId={wsId}
            selection={selected}
            onApply={applyRewrite}
            onDismiss={() => setRange(null)}
          />
        </div>
      )}

      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span>{binary ? (KIND_LABEL[kind] ?? "Binary file") : languageOf(openFile)}</span>
        {showEditor && (
          <span className="tabular-nums">
            Ln {position.line}, Col {position.column}
          </span>
        )}
        <span className="flex-1" />
        <span className="truncate">
          {data?.storageAsset
            ? "Stored file — upload a replacement to change it"
            : binary
              ? "Read-only preview"
              : data?.truncated
                ? "Truncated — too large to edit here"
                : dirty
                  ? "Unsaved — kept in this browser until you save"
                  : "Saving commits to the workspace repo"}
        </span>
      </div>
    </div>
  )
}
