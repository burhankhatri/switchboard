"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, CalendarClock, FileText, Hash, PenLine, Plus, Sparkles, StickyNote, TextQuote } from "lucide-react"
import type { HomeJob } from "@/lib/workspace-home/home"
import type { WidgetDto } from "@/lib/workspace-home/widget-dto"
import type { RepoFile } from "@/lib/workspace-repo"
import { MAX_WIDGETS_PER_WORKSPACE } from "@/lib/workspace-home/widgets"
import { notify } from "@/lib/notify"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WidgetCard } from "./WidgetCard"
import { WidgetEditorDialog, type EditorTarget } from "./WidgetEditorDialog"
import { useWidgetMutations } from "./useWidgetMutations"

/**
 * What "Ask the agent" sends when there is no summary. Short, because a person
 * reads it in the composer before sending, and specific about the shapes, or
 * the agent answers in paragraphs.
 */
export const SUMMARY_PROMPT =
  "Summarise this workspace for its home page. Read the files, git history and live data " +
  "(read-only), then pin a summary (key \"summary\"): one headline sentence on where things stand " +
  "and up to 5 short points. Add a kpis strip of the key numbers and an actions list of anything " +
  "waiting on a person. Real data only."

export function WidgetGrid({
  workspaceId,
  widgets: stored,
  jobs,
  onOpenChat,
  onOpenFile,
  onAskAgent,
}: {
  workspaceId: string
  widgets: WidgetDto[]
  jobs: HomeJob[]
  onOpenChat: (chatId: string) => void
  onOpenFile: (path: string) => void
  /** Start a chat with this prompt in the composer. */
  onAskAgent: (prompt: string) => void
}) {
  // The summary leads the page wherever it was pinned: it is the answer to
  // "what is going on here", and everything else is detail under it.
  const widgets = useMemo(
    () => [...stored.filter((w) => w.type === "summary"), ...stored.filter((w) => w.type !== "summary")],
    [stored]
  )
  const hasSummary = widgets[0]?.type === "summary"
  const { create, update, remove, reorder } = useWidgetMutations(workspaceId)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  // Only fetched when a file widget exists. Shares the file panel's cache slot
  // and shape, so it is usually already there.
  const hasFileWidget = widgets.some((w) => w.type === "file")
  const { data: files } = useQuery({
    queryKey: ["workspace-files", workspaceId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${workspaceId}/files`)
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as { workspace: RepoFile[]; shared: RepoFile[] }
    },
    enabled: hasFileWidget,
    staleTime: 60_000,
    retry: false,
  })
  const paths = useMemo(
    () => (files ? new Set(files.workspace.map((f) => f.path)) : null),
    [files]
  )
  // undefined while unknown, so a card does not flash "deleted" during load.
  const fileExists = (path: string) => (paths ? paths.has(path) : undefined)

  const order = widgets.map((w) => w.id)
  const moveTo = (id: string, target: number) => {
    const from = order.indexOf(id)
    if (from < 0 || target < 0 || target >= order.length || from === target) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(target, 0, id)
    reorder.mutate(next, { onError: (e) => notify({ title: e.message }) })
  }

  const full = widgets.length >= MAX_WIDGETS_PER_WORKSPACE

  return (
    <section className="mt-6">
      {!hasSummary && (
        <div className="mb-3 rounded-2xl border border-dashed border-line-strong bg-surface p-6 sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Summary</p>
          <p className="mt-3 font-display text-[22px] leading-snug tracking-tight text-ink-2">
            No summary yet. One sentence on where things stand, and the points behind it, so
            anyone opening this workspace knows what is going on.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => onAskAgent(SUMMARY_PROMPT)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask the agent to write it
            </button>
            <button
              onClick={() => setEditor({ mode: "create", type: "summary" })}
              disabled={full}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[13px] text-ink-2 hover:bg-hover cursor-pointer disabled:opacity-50"
            >
              <PenLine className="h-3.5 w-3.5" />
              Write it yourself
            </button>
          </div>
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong p-5 text-[13px] text-ink-3">
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Numbers, charts and timelines pinned here show to everyone in the workspace. Pin a
            result from a chat, or ask the agent to “put this week’s numbers on the home page”.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
              widget={w}
              jobs={jobs}
              fileExists={fileExists}
              onOpenChat={onOpenChat}
              onOpenFile={onOpenFile}
              onEdit={() => setEditor({ mode: "edit", widget: w })}
              onRemove={() =>
                remove.mutate(w.id, { onError: (e) => notify({ title: e.message }) })
              }
              onMove={(delta) => moveTo(w.id, i + delta)}
              dragging={dragId === w.id}
              dragProps={{
                draggable: true,
                onDragStart: (e) => {
                  setDragId(w.id)
                  e.dataTransfer.effectAllowed = "move"
                },
                onDragEnd: () => setDragId(null),
                onDragOver: (e) => {
                  if (dragId && dragId !== w.id) e.preventDefault()
                },
                onDrop: (e) => {
                  e.preventDefault()
                  if (dragId) moveTo(dragId, i)
                  setDragId(null)
                },
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={full}
            title={full ? `A workspace holds at most ${MAX_WIDGETS_PER_WORKSPACE} widgets` : undefined}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-hover cursor-pointer disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add widget
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Add to the home page</DropdownMenuLabel>
            {!hasSummary && (
              <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "summary" })}>
                <TextQuote className="mr-2 h-3.5 w-3.5" /> Summary
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "stat" })}>
              <Hash className="mr-2 h-3.5 w-3.5" /> Number
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "note" })}>
              <StickyNote className="mr-2 h-3.5 w-3.5" /> Note
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "file" })}>
              <FileText className="mr-2 h-3.5 w-3.5" /> File
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={jobs.length === 0}
              onSelect={() => setEditor({ mode: "create", type: "job" })}
            >
              <CalendarClock className="mr-2 h-3.5 w-3.5" /> Job status
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAskAgent("Put a chart on the home page showing ")}>
              <Sparkles className="mr-2 h-3.5 w-3.5" /> Ask the agent for a chart…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <WidgetEditorDialog
        workspaceId={workspaceId}
        target={editor}
        jobs={jobs}
        onClose={() => setEditor(null)}
        onSubmit={(value) =>
          editor?.mode === "edit"
            ? update.mutateAsync({ id: editor.widget.id, ...value })
            : create.mutateAsync({ type: editor!.type, title: value.title, content: value.content })
        }
      />
    </section>
  )
}
