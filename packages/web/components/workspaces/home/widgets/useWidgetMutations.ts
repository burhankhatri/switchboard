"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { workspaceHomeKey } from "@/lib/query/hooks/useWorkspaceHome"
import type { WorkspaceHome } from "@/lib/workspace-home/home"

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error((await r.json().catch(() => ({}))).error ?? `Request failed (${r.status})`)
  }
  return r.status === 204 ? null : r.json()
}

export interface NewWidget {
  type: string
  title: string
  content: unknown
  via?: "pin"
  sourceChatId?: string
  sourceMessageId?: string
}

export function useWidgetMutations(workspaceId: string) {
  const qc = useQueryClient()
  const base = `/api/workspaces/${workspaceId}/widgets`
  const refresh = () => qc.invalidateQueries({ queryKey: workspaceHomeKey(workspaceId) })

  const create = useMutation({
    mutationFn: (w: NewWidget) => send(base, "POST", w),
    onSuccess: refresh,
  })

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; content?: unknown }) =>
      send(`${base}/${id}`, "PATCH", patch),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: string) => send(`${base}/${id}`, "DELETE"),
    onSuccess: refresh,
  })

  // Optimistic: dragging a card and watching it jump back while the request
  // is in flight reads as the drop having failed.
  const reorder = useMutation({
    mutationFn: (ids: string[]) => send(base, "PUT", { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: workspaceHomeKey(workspaceId) })
      const prev = qc.getQueryData<WorkspaceHome>(workspaceHomeKey(workspaceId))
      if (prev) {
        const byId = new Map(prev.widgets.map((w) => [w.id, w]))
        qc.setQueryData<WorkspaceHome>(workspaceHomeKey(workspaceId), {
          ...prev,
          widgets: ids.map((id, position) => ({ ...byId.get(id)!, position })),
        })
      }
      return { prev }
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(workspaceHomeKey(workspaceId), ctx.prev)
    },
    onSettled: refresh,
  })

  return { create, update, remove, reorder }
}
