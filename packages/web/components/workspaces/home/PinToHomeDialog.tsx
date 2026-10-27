"use client"

import { useEffect, useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Pin, X } from "lucide-react"
import { pinProposals, type PinProposal } from "@/lib/workspace-home/pin-detect"
import { workspaceHomeKey } from "@/lib/query/hooks/useWorkspaceHome"
import type { NoteContent, StatContent, TableContent } from "@/lib/workspace-home/widgets"
import { cn } from "@/lib/utils"
import { NoteBody, StatBody, TableBody } from "./widgets/bodies"

const LABEL: Record<PinProposal["type"], string> = { table: "Table", stat: "Number", note: "Note" }

/**
 * Pin an agent's answer to the workspace home page. The proposal is a best
 * guess from the text; the person picks the form and the title before it is
 * saved, and nothing is sent until they do.
 */
export function PinToHomeDialog({
  workspaceId,
  chatId,
  message,
  onClose,
}: {
  workspaceId: string
  chatId: string
  message: { id: string; content: string } | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const proposals = useMemo(() => (message ? pinProposals(message.content) : []), [message])
  const [index, setIndex] = useState(0)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = proposals[index]
  useEffect(() => {
    setIndex(0)
    setError(null)
  }, [message])
  useEffect(() => {
    if (chosen) setTitle(chosen.title)
  }, [chosen])

  const save = async () => {
    if (!message || !chosen) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: chosen.type,
          title: title.trim(),
          content: chosen.content,
          via: "pin",
          sourceChatId: chatId,
          sourceMessageId: message.id,
        }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not pin it")
      await qc.invalidateQueries({ queryKey: workspaceHomeKey(workspaceId) })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pin it")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={!!message} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 app-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-popover p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Pin className="h-4 w-4" />
              Pin to the workspace home page
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent cursor-pointer" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[12px] text-ink-3">
            Everyone in the workspace will see this, with a note that it came from your chat.
          </Dialog.Description>

          {proposals.length > 1 && (
            <div className="mt-4 inline-flex w-fit rounded-lg border border-line p-0.5" role="radiogroup">
              {proposals.map((p, i) => (
                <button
                  key={p.type}
                  role="radio"
                  aria-checked={i === index}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] cursor-pointer",
                    i === index ? "bg-inset text-ink" : "text-ink-3 hover:text-ink-2"
                  )}
                >
                  {LABEL[p.type]}
                </button>
              ))}
            </div>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block text-[12px] text-ink-2">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary"
            />
          </label>

          <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface p-4">
            {chosen?.type === "table" && <TableBody content={chosen.content as TableContent} />}
            {chosen?.type === "stat" && <StatBody content={chosen.content as StatContent} />}
            {chosen?.type === "note" && <NoteBody content={chosen.content as NoteContent} />}
          </div>

          {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="rounded-md px-3 py-1.5 text-sm hover:bg-accent cursor-pointer">Cancel</Dialog.Close>
            <button
              onClick={() => void save()}
              disabled={saving || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Pin
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

