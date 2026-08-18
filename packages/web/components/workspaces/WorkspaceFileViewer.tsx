"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X, FileText, Check, RefreshCw } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import {
  clearDraft,
  readCachedFile,
  readDraft,
  writeCachedFile,
  writeDraft,
} from "@/lib/workspace-file-cache"
import { SelectionActions } from "./SelectionActions"
import { cn } from "@/lib/utils"

interface FilePayload { path: string; content: string; truncated: boolean; sha: string }

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
  const { activeWorkspace, openFile, setOpenFile } = useWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Selection is tracked as offsets rather than the text itself, so applying a
  // rewrite can splice it back into exactly the range that was highlighted.
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const qc = useQueryClient()
  const wsId = activeWorkspace?.id ?? ""

  // Seeded synchronously so the first paint already has content for any file
  // opened before. Recomputed per file, not per render.
  const cached = useMemo(
    () => (wsId && openFile ? readCachedFile(wsId, openFile) : null),
    [wsId, openFile]
  )
  // Captured with the cache read, not on every render — a fresh Date.now() each
  // render would keep pushing the staleness deadline out and the query would
  // never revalidate.
  const cachedAt = useMemo(() => (cached ? Date.now() : 0), [cached])

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["workspace-file", wsId, openFile],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsId}/files?path=${encodeURIComponent(openFile!)}`)
      if (!r.ok) throw new Error(String(r.status))
      const file = (await r.json()) as FilePayload
      writeCachedFile(wsId, openFile!, {
        content: file.content,
        sha: file.sha,
        truncated: file.truncated,
      })
      return file
    },
    enabled: !!wsId && !!openFile,
    retry: false,
    initialData: cached && openFile ? { path: openFile, ...cached } : undefined,
    // Seeded data counts as fetched-now, so a warm cache paints AND skips the
    // refetch inside staleTime. This was 0 (= infinitely stale), which meant
    // every open still waited on the network and the local cache bought
    // nothing. Staleness is bounded by staleTime, and the server revalidates
    // against GitHub with an ETag, so a genuinely changed file still lands.
    initialDataUpdatedAt: cachedAt,
    staleTime: 30 * 1000,
  })

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
  }, [wsId, openFile])

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

  return (
    <div className="flex h-full w-full max-w-3xl mx-auto flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground truncate flex-1">{openFile}</span>
        {/* Revalidation is ambient, not a wait — it must never look like one. */}
        {isFetching && !isPending && (
          <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground/60" aria-label="Syncing" />
        )}
        {dirty && <span className="text-xs text-muted-foreground">unsaved</span>}
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <Check className="h-3 w-3" /> {save.isPending ? "saved locally" : "committed"}
          </span>
        )}
        <button
          onClick={() => save.mutate(value)}
          disabled={!dirty || data?.truncated}
          title={data?.truncated ? "This file is too large to edit here" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer",
            "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
          )}
        >
          Save
        </button>
        <button
          onClick={() => setOpenFile(null)}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Close file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Only a file never opened before can show a loading state. */}
      {isPending && (
        <div className="flex-1 animate-pulse rounded-xl border border-border bg-card" aria-label="Loading" />
      )}
      {error && !data && <p className="text-sm text-muted-foreground py-6">Could not open this file.</p>}
      {save.error && <p className="text-sm text-destructive mb-2">{(save.error as Error).message}</p>}

      {data && (
        // min-h-0 is load-bearing: without it the textarea's own content height
        // becomes the flex floor and the editor stops shrinking to its pane.
        <div className="flex min-h-0 flex-1 flex-col">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onEdit(e.target.value)}
            onSelect={syncSelection}
            onKeyUp={syncSelection}
            onMouseUp={syncSelection}
            spellCheck={false}
            readOnly={data.truncated}
            // Fills the pane rather than a fixed 22 rows, which left the editor
            // floating in a tall empty region.
            className="min-h-0 w-full flex-1 resize-none rounded-xl border border-border bg-card p-4 text-xs leading-relaxed font-mono outline-none focus:ring-2 focus:ring-ring/40"
          />
          {wsId && (
            <SelectionActions
              workspaceId={wsId}
              selection={selected}
              onApply={applyRewrite}
              onDismiss={() => setRange(null)}
            />
          )}

          <p className="mt-2 shrink-0 text-xs text-muted-foreground">
            {data.truncated
              ? "Truncated — too large to edit here."
              : "Edits are kept in this browser as you type. Saving commits to the workspaces repo, and the next run picks it up."}
          </p>
        </div>
      )}
    </div>
  )
}
