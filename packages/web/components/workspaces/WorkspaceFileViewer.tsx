"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X, Loader2, FileText, Check } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
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
 */
export function WorkspaceFileViewer() {
  const { activeWorkspace, openFile, setOpenFile } = useWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-file", activeWorkspace?.id, openFile],
    queryFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/files?path=${encodeURIComponent(openFile!)}`).then(
        (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<FilePayload> }
      ),
    enabled: !!activeWorkspace && !!openFile,
    retry: false,
  })

  // Reset the draft whenever a different file is opened, or a reload brings
  // newer content — otherwise you would edit one file's text over another's.
  useEffect(() => { setDraft(null); setSaved(false) }, [openFile, data?.sha])

  const save = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/workspaces/${activeWorkspace!.id}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openFile, content, sha: data?.sha }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed")
      return res.json()
    },
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ["workspace-file", activeWorkspace?.id, openFile] })
      qc.invalidateQueries({ queryKey: ["workspace-files", activeWorkspace?.id] })
    },
  })

  if (!openFile) return null
  const value = draft ?? data?.content ?? ""
  const dirty = draft !== null && draft !== data?.content

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground truncate flex-1">{openFile}</span>
        {dirty && !save.isPending && <span className="text-xs text-muted-foreground">unsaved</span>}
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <Check className="h-3 w-3" /> committed
          </span>
        )}
        <button
          onClick={() => save.mutate(value)}
          disabled={!dirty || save.isPending || data?.truncated}
          title={data?.truncated ? "This file is too large to edit here" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer",
            "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
          )}
        >
          {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
        </button>
        <button
          onClick={() => setOpenFile(null)}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Close file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-sm text-muted-foreground py-6">Could not open this file.</p>}
      {save.error && <p className="text-sm text-destructive mb-2">{(save.error as Error).message}</p>}

      {data && (
        <>
          <textarea
            value={value}
            onChange={(e) => { setDraft(e.target.value); setSaved(false) }}
            spellCheck={false}
            readOnly={data.truncated}
            rows={22}
            className="w-full rounded-xl border border-border bg-card p-4 text-xs leading-relaxed font-mono outline-none focus:ring-2 focus:ring-ring/40 resize-y"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {data.truncated
              ? "Truncated — too large to edit here."
              : "Saving commits to the workspaces repo. The next run picks it up."}
          </p>
        </>
      )}
    </div>
  )
}
