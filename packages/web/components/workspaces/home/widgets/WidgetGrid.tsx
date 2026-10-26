"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, CalendarClock, FileText, Hash, LayoutGrid, Plus, StickyNote } from "lucide-react"
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

export function WidgetGrid({
  workspaceId,
  widgets,
  jobs,
  onOpenChat,
  onOpenFile,
}: {
  workspaceId: string
  widgets: WidgetDto[]
  jobs: HomeJob[]
  onOpenChat: (chatId: string) => void
  onOpenFile: (path: string) => void
}) {
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
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">
          <LayoutGrid className="h-3 w-3" />
          Pinned
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={full}
            title={full ? `A workspace holds at most ${MAX_WIDGETS_PER_WORKSPACE} widgets` : undefined}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-hover cursor-pointer disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            Add
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Add to the home page</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "note" })}>
              <StickyNote className="mr-2 h-3.5 w-3.5" /> Note
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditor({ mode: "create", type: "stat" })}>
              <Hash className="mr-2 h-3.5 w-3.5" /> Number
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {widgets.length === 0 ? (
        <div className="mt-2 flex items-start gap-3 rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-3">
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Nothing pinned yet. Pin a result from a chat, add a note or a file here, or ask the
            agent to “pin this week’s numbers to the home page”.
          </p>
        </div>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
