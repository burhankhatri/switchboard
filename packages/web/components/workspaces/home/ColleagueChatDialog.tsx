"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { SharedChatMessages } from "@/components/share/SharedChatView"
import type { SharedChat } from "@/lib/server/shared-chat"

interface WorkspaceChat extends SharedChat {
  owner: { id: string; name: string | null }
  isYours: boolean
  sharedAt: string | null
  run: { id: string; jobId: string; jobName: string } | null
}

/**
 * A chat someone else in the workspace shared, or a scheduled run's chat,
 * opened over the home page. Read-only by construction: it is fed by the
 * members' read route and has no composer.
 */
export function ColleagueChatDialog({
  workspaceId,
  chatId,
  onClose,
}: {
  workspaceId: string
  chatId: string | null
  onClose: () => void
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ["workspace-chat", workspaceId, chatId],
    queryFn: async (): Promise<WorkspaceChat> => {
      const r = await fetch(`/api/workspaces/${workspaceId}/chats/${chatId}`)
      if (!r.ok) throw new Error(r.status === 404 ? "This chat is no longer shared." : "Could not load the chat.")
      return r.json()
    },
    enabled: !!chatId,
    retry: false,
  })

  const subtitle = data?.run
    ? `A run of ${data.run.jobName}, set up by ${data.owner.name ?? "a member"}`
    : data
      ? `Shared by ${data.isYours ? "you" : (data.owner.name ?? "a member")}`
      : null

  return (
    <Dialog.Root open={!!chatId} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 app-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-medium text-foreground">
                {data?.displayName || (data?.run ? data.run.jobName : "Chat")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                {subtitle ?? "Loading…"}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                Read-only
              </span>
              <Dialog.Close
                className="rounded-md p-1 text-muted-foreground hover:bg-accent cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {isPending ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">{error.message}</p>
            ) : (
              data && <SharedChatMessages chat={data} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
