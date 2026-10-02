"use client"

import { useCallback, useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"

export function DeleteFileDialog({ workspaceId, path, onCancel, onDeleted }: {
  workspaceId: string; path: string; onCancel: () => void; onDeleted: () => void;
}) {
  const [sha, setSha] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const loadVersion = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/files?path=${encodeURIComponent(path)}`, { cache: "no-store", signal })
      const body = await response.json()
      if (!response.ok || !body.sha) throw new Error(body.error ?? "Could not read the file version")
      if (!signal?.aborted) setSha(body.sha)
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Could not read file")
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [workspaceId, path])
  useEffect(() => {
    const controller = new AbortController()
    void loadVersion(controller.signal)
    return () => controller.abort()
  }, [loadVersion])

  const remove = async () => {
    if (deleting || !sha) return
    setDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, sha }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? "Delete failed. Try again.")
      }
      onDeleted()
    } catch (err) { setError(err instanceof Error ? err.message : "Delete failed") }
    finally { setDeleting(false) }
  }
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !deleting) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] app-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Delete file?</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            Delete <span className="break-all font-medium text-foreground">{path.split("/").pop()}</span> from this workspace for everyone? Any unsaved edits will be discarded. This cannot be undone here.
          </Dialog.Description>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={deleting} onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">Cancel</button>
            {!sha && error ? (
              <button type="button" disabled={loading} onClick={() => void loadVersion()} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Retry</button>
            ) : (
              <button type="button" disabled={loading || deleting || !sha} onClick={() => void remove()} className="rounded-md bg-destructive px-3 py-1.5 text-sm text-white disabled:opacity-50">
                {loading ? "Loading…" : deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
