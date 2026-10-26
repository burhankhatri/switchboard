"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Loader2, Pencil, Sparkles } from "lucide-react"
import { MarkdownPreview } from "@/lib/file-preview/MarkdownPreview"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { cn } from "@/lib/utils"

export const BRIEF_FILE = "HOME.md"

export const workspaceBriefKey = (workspaceId: string) => ["workspace-brief", workspaceId] as const

/**
 * Sent as a draft, not dispatched: the member sees what will be asked and can
 * add to it before it runs.
 */
export const DRAFT_BRIEF_PROMPT = [
  `Write ${BRIEF_FILE} at the root of this workspace folder: a short brief for a colleague who did not build any of this and is not technical.`,
  "Cover, in plain language: what this workspace is for; what it is connected to; what runs on a schedule and what each job does; and how to ask for things, with three example requests.",
  "Base it only on the skills, scripts, connections and scheduled jobs you can actually see. Keep it under 300 words, no jargon, then commit it.",
].join("\n\n")

const STARTER_BRIEF = `# What this workspace does

<!-- One or two sentences a new colleague can read in ten seconds. -->

## What runs on its own

<!-- Each scheduled job and what it produces. -->

## How to use it

<!-- Three things you can ask it, written the way you would ask. -->
`

interface BriefFile {
  content: string
  truncated: boolean
}

/**
 * The workspace's own description of itself, from HOME.md in its folder.
 *
 * The repo is the only source: what a member edits here is what the next run
 * clones, and the agent can update it like any other file.
 */
export function HomeBrief({
  onDraftWithAgent,
}: {
  onDraftWithAgent: (prompt: string) => void
}) {
  const { activeWorkspace, requestOpenFile } = useWorkspace()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const wsId = activeWorkspace?.id
  const path = activeWorkspace ? `${activeWorkspace.path}/${BRIEF_FILE}` : null

  const { data, isPending, error } = useQuery({
    queryKey: workspaceBriefKey(wsId ?? ""),
    queryFn: async (): Promise<BriefFile | null> => {
      const r = await fetch(`/api/workspaces/${wsId}/files?path=${encodeURIComponent(path!)}`)
      if (r.status === 404) return null
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    },
    enabled: !!wsId && !!path,
    staleTime: 15_000,
    retry: false,
  })

  if (!wsId || !path) return null

  // Creating goes through the same save route as the editor, so it is an
  // ordinary attributed commit to the workspace branch, then opens for editing.
  const writeItYourself = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const r = await fetch(`/api/workspaces/${wsId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: STARTER_BRIEF, sha: "" }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not create it")
      await qc.invalidateQueries({ queryKey: workspaceBriefKey(wsId) })
      await requestOpenFile(path)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create it")
    } finally {
      setCreating(false)
    }
  }

  if (isPending) {
    return <div className="mt-6 h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
  }

  if (error) {
    return (
      <p className="mt-6 text-sm text-ink-3">
        The workspace brief could not be loaded. It will be retried when you come back.
      </p>
    )
  }

  if (!data) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface p-5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-ink-3" />
          <h2 className="text-sm font-medium text-ink">No brief yet</h2>
        </div>
        <p className="mt-1.5 text-sm text-ink-2">
          A short {BRIEF_FILE} tells anyone who opens this workspace what it does and how to use
          it, without having to read its skills.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onDraftWithAgent(DRAFT_BRIEF_PROMPT)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Have the agent draft it
          </button>
          <button
            onClick={() => void writeItYourself()}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-hover cursor-pointer disabled:opacity-60"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
            Write it yourself
          </button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          The agent works on its own branch, so its draft shows here once that branch is merged.
        </p>
        {createError && <p className="mt-2 text-[12px] text-destructive">{createError}</p>}
      </section>
    )
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-hairline">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-3">About this workspace</span>
        <button
          onClick={() => void requestOpenFile(path)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-hover cursor-pointer"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
      {data.truncated ? (
        <p className="p-4 text-sm text-ink-3">{BRIEF_FILE} is too large to show here. Open it to read it.</p>
      ) : (
        <>
          <div className={cn("relative", !expanded && "max-h-80 overflow-hidden")}>
            <MarkdownPreview content={data.content} currentFilePath={path} />
            {!expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" />
            )}
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full border-t border-line py-1.5 text-[12px] text-ink-3 hover:bg-hover cursor-pointer"
          >
            {expanded ? "Show less" : "Show all"}
          </button>
        </>
      )}
    </section>
  )
}
