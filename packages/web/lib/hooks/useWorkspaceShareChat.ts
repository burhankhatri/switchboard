"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query"
import { workspaceHomeKey } from "@/lib/query/hooks/useWorkspaceHome"
import type { Chat } from "@/lib/types"

// =============================================================================
// useWorkspaceShareChat — let the chat's workspace members read it, or stop
// =============================================================================
//
// The colleague-facing counterpart of useShareChat. Callers key the host
// component by chatId, as with useShareChat, so state resets between chats.

export function useWorkspaceShareChat(
  chatId: string,
  workspaceId: string | null | undefined,
  initialSharedAt?: number | null
) {
  const [sharedAt, setSharedAt] = useState<number | null>(initialSharedAt ?? null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const apply = (value: number | null) => {
    setSharedAt(value)
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (prev) =>
      prev?.map((c) => (c.id === chatId ? { ...c, sharedToWorkspaceAt: value } : c))
    )
    queryClient.setQueryData<Chat>(queryKeys.chats.detail(chatId), (prev) =>
      prev ? { ...prev, sharedToWorkspaceAt: value } : prev
    )
    // The home page lists shared chats and links feed events to them.
    if (workspaceId) void queryClient.invalidateQueries({ queryKey: workspaceHomeKey(workspaceId) })
  }

  const toggle = async () => {
    const sharing = !sharedAt
    setBusy(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/workspace-share`, {
        method: sharing ? "POST" : "DELETE",
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { sharedToWorkspaceAt: string | null }
      apply(data.sharedToWorkspaceAt ? Date.parse(data.sharedToWorkspaceAt) : null)
    } catch {
      notify({ title: sharing ? "Couldn't share with the workspace" : "Couldn't stop sharing" })
    } finally {
      setBusy(false)
    }
  }

  return { shared: !!sharedAt, busy, toggle }
}
