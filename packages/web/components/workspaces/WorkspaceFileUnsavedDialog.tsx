"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { ModalHeader } from "@/components/ui/modal-header"
import { cn } from "@/lib/utils"
import {
  clearDraft,
  readCachedFile,
  readDraft,
  writeCachedFile,
} from "@/lib/workspace-file-cache"

interface WorkspaceFileUnsavedDialogProps {
  open: boolean
  workspaceId: string
  path: string
  onCancel: () => void
  onDiscard: () => void
  onSaved: () => void
}

export function WorkspaceFileUnsavedDialog({
  open,
  workspaceId,
  path,
  onCancel,
  onDiscard,
  onSaved,
}: WorkspaceFileUnsavedDialogProps) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cached = readCachedFile(workspaceId, path)
  const truncated = cached?.truncated ?? false
  const filename = path.split("/").pop() ?? path

  const handleSave = async () => {
    const draft = readDraft(workspaceId, path)
    const content = draft?.content ?? cached?.content ?? ""
    const sha = cached?.sha ?? draft?.baseSha ?? ""
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, sha }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Save failed")
      }
      const data = (await res.json()) as { path: string; sha: string }
      clearDraft(workspaceId, path)
      writeCachedFile(workspaceId, path, { content, sha: data.sha, truncated: false })
      qc.setQueryData(["workspace-file", workspaceId, path], (prev: { content: string; sha: string } | undefined) =>
        prev ? { ...prev, content, sha: data.sha } : prev
      )
      qc.invalidateQueries({ queryKey: ["workspace-files", workspaceId] })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay data-workspace-file-unsaved className="fixed inset-0 z-[60] app-scrim" />
        <Dialog.Content
          data-workspace-file-unsaved
          className={cn(
            "fixed top-1/2 left-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-popover shadow-xl overflow-hidden flex flex-col"
          )}
        >
          <Dialog.Title className="sr-only">Save changes?</Dialog.Title>
          <ModalHeader title="Save changes?" />
          <div className="px-4 pt-3 pb-4 space-y-4 text-sm">
            <p className="text-muted-foreground">
              You have unsaved changes to <span className="font-mono text-foreground">{filename}</span>.
              {truncated ? " This file is too large to save here — discard to continue." : " Save or discard before leaving."}
            </p>
            {error && <p className="text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
              >
                Discard
              </button>
              {!truncated && (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
