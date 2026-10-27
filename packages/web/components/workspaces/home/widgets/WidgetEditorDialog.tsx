"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import type { HomeJob } from "@/lib/workspace-home/home"
import type { WidgetDto } from "@/lib/workspace-home/widget-dto"
import type { RepoFile } from "@/lib/workspace-repo"

/** Types a person can make from scratch; the data-heavy ones come from pins and agents. */
export type HandMadeType = "summary" | "note" | "stat" | "file" | "job"

export type EditorTarget =
  | { mode: "create"; type: HandMadeType; preset?: { title?: string; content?: Record<string, unknown> } }
  | { mode: "edit"; widget: WidgetDto }

const inputCls =
  "w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary"

const TYPE_NAME: Record<string, string> = {
  summary: "summary",
  kpis: "numbers",
  funnel: "funnel",
  timeline: "timeline",
  actions: "to-do list",
  note: "note",
  stat: "number",
  file: "file",
  job: "job",
  table: "table",
  chart: "chart",
}

export function WidgetEditorDialog({
  workspaceId,
  target,
  jobs,
  onClose,
  onSubmit,
}: {
  workspaceId: string
  target: EditorTarget | null
  jobs: HomeJob[]
  onClose: () => void
  onSubmit: (value: { title: string; content?: unknown }) => Promise<unknown>
}) {
  const type = target?.mode === "create" ? target.type : target?.widget.type
  const existing = target?.mode === "edit" ? (target.widget.content as Record<string, unknown>) : undefined
  const preset = target?.mode === "create" ? target.preset : undefined

  const [title, setTitle] = useState("")
  const [markdown, setMarkdown] = useState("")
  const [headline, setHeadline] = useState("")
  const [points, setPoints] = useState("")
  const [value, setValue] = useState("")
  const [unit, setUnit] = useState("")
  const [note, setNote] = useState("")
  const [path, setPath] = useState("")
  const [jobId, setJobId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    const c = existing ?? preset?.content ?? {}
    setTitle(
      target.mode === "edit"
        ? target.widget.title
        : (preset?.title ?? (target.type === "summary" ? "Where things stand" : ""))
    )
    setHeadline(typeof c.headline === "string" ? c.headline : "")
    setPoints(
      Array.isArray(c.points) ? (c.points as { text: string }[]).map((p) => p.text).join("\n") : ""
    )
    setMarkdown(typeof c.markdown === "string" ? c.markdown : "")
    setValue(c.value !== undefined ? String(c.value) : "")
    setUnit(typeof c.unit === "string" ? c.unit : "")
    setNote(typeof c.note === "string" ? c.note : "")
    setPath(typeof c.path === "string" ? c.path : "")
    setJobId(typeof c.jobId === "string" ? c.jobId : "")
    setError(null)
  }, [target])

  const { data: files } = useQuery({
    queryKey: ["workspace-files", workspaceId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${workspaceId}/files`)
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as { workspace: RepoFile[]; shared: RepoFile[] }
    },
    enabled: type === "file",
    staleTime: 60_000,
    retry: false,
  })

  // Data-heavy types are edited by whatever produced them; by hand, only the
  // title. Their other fields would be a spreadsheet editor nobody asked for.
  const titleOnly =
    type === "table" ||
    type === "chart" ||
    type === "kpis" ||
    type === "funnel" ||
    type === "timeline" ||
    type === "actions"

  const buildContent = (): unknown => {
    if (titleOnly) return undefined
    switch (type) {
      case "summary": {
        // A point that survives an edit keeps the tone the agent gave it.
        const before = new Map(
          ((existing?.points as { text: string; tone?: string }[] | undefined) ?? []).map((p) => [p.text, p.tone])
        )
        const list = points
          .split("\n")
          .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
          .filter(Boolean)
          .slice(0, 5)
          .map((text) => (before.get(text) ? { text, tone: before.get(text) } : { text }))
        return {
          ...(existing ?? {}),
          headline: headline.trim(),
          ...(list.length ? { points: list } : { points: undefined }),
        }
      }
      case "note":
        return { markdown }
      case "stat": {
        const numeric = value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value.trim()
        return {
          ...(existing ?? {}),
          value: numeric,
          ...(unit.trim() ? { unit: unit.trim() } : { unit: undefined }),
          ...(note.trim() ? { note: note.trim() } : { note: undefined }),
        }
      }
      case "file":
        return { path }
      case "job":
        return { jobId }
    }
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      // JSON drops the undefined keys, so a cleared unit or note is removed.
      const content = buildContent()
      await onSubmit({ title: title.trim(), content: content === undefined ? undefined : JSON.parse(JSON.stringify(content)) })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const heading = target?.mode === "edit" ? `Edit ${TYPE_NAME[type ?? ""] ?? "widget"}` : `Add a ${TYPE_NAME[type ?? ""]}`

  return (
    <Dialog.Root open={!!target} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 app-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-medium text-foreground">{heading}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent cursor-pointer" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Every member sees this on the home page.</Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-2">Title</span>
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </label>

            {type === "summary" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[12px] text-ink-2">Where things stand, in one sentence</span>
                  <textarea
                    className={`${inputCls} min-h-16`}
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    maxLength={240}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] text-ink-2">Key points, one per line (up to 5)</span>
                  <textarea
                    className={`${inputCls} min-h-24`}
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                </label>
              </>
            )}

            {type === "note" && (
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-2">Note (Markdown)</span>
                <textarea
                  className={`${inputCls} min-h-32 font-mono`}
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  maxLength={8000}
                />
              </label>
            )}

            {type === "stat" && (
              <>
                <div className="flex gap-2">
                  <label className="block flex-1">
                    <span className="mb-1 block text-[12px] text-ink-2">Value</span>
                    <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} />
                  </label>
                  <label className="block w-28">
                    <span className="mb-1 block text-[12px] text-ink-2">Unit</span>
                    <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[12px] text-ink-2">Note</span>
                  <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
                </label>
              </>
            )}

            {type === "file" && (
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-2">File</span>
                <select className={inputCls} value={path} onChange={(e) => setPath(e.target.value)}>
                  <option value="">Choose a file…</option>
                  {(files?.workspace ?? []).map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {type === "job" && (
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-2">Job</span>
                <select className={inputCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">Choose a job…</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="text-[12px] text-ink-3">Everyone in this workspace sees this on the home page.</p>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="rounded-md px-3 py-1.5 text-sm hover:bg-accent cursor-pointer">Cancel</Dialog.Close>
            <button
              onClick={() => void submit()}
              disabled={saving || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {target?.mode === "edit" ? "Save" : "Add to home"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
