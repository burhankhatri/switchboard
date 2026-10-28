"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"

export interface ChatApprovalItem {
  id: string
  action: string
  count: number | null
  campaign: string | null
  status: "pending" | "approved"
  createdAt: string
}

async function fetchApprovals(chatId: string): Promise<ChatApprovalItem[]> {
  const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/approvals`)
  if (!res.ok) throw new Error(`Failed to load approvals (${res.status})`)
  return ((await res.json()) as { approvals: ChatApprovalItem[] }).approvals
}

/**
 * What the agent is waiting on. No interval: a request appears only when a
 * turn ends, and the stream's complete handler invalidates this key then.
 */
export function useChatApprovalsQuery(chatId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.chats.approvals(chatId ?? ""),
    queryFn: () => fetchApprovals(chatId!),
    enabled: !!chatId,
    staleTime: 60_000,
    refetchInterval: false,
  })
}

export function useDecideApprovalMutation(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approve" | "decline" }) => {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/approvals/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `Failed (${res.status})`)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.approvals(chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
    },
  })
}
