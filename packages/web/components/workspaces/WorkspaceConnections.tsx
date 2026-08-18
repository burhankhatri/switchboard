"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plug, Plus, Trash2 } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useWorkspaceOverview } from "@/lib/query/hooks/useWorkspaceOverview"
import {
  useWorkspaceConnections,
  workspaceConnectionsKey,
} from "@/lib/query/hooks/useWorkspaceConnections"
import { WorkspaceConnectionDialog } from "./WorkspaceConnectionDialog"
import { WorkspaceConnectionDetail } from "./WorkspaceConnectionDetail"

interface Connection {
  id: string
  kind: "rest" | "mcp"
  name: string
  slug: string
  description: string | null
  baseUrl: string | null
  authType: string | null
  authParam: string | null
  mcpUrl: string | null
  hasSecret: boolean
  env: { baseUrl: string; token: string } | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

/**
 * What this workspace can reach: REST APIs and MCP servers.
 *
 * The list stays compact; adding one opens a dialog so the sidebar does not
 * grow a form. Secrets are write-only — the API never returns a value.
 */
export function WorkspaceConnections() {
  const { activeWorkspace } = useWorkspace()
  const [adding, setAdding] = useState(false)
  // Which connection's configuration is open in the centre dialog.
  const [viewing, setViewing] = useState<Connection | null>(null)
  // Names only — used to tell the user when a workspace is serving fixtures.
  const { data: overview } = useWorkspaceOverview(activeWorkspace?.id)
  const envKeys = overview?.envKeys ?? []
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const key = workspaceConnectionsKey(activeWorkspace?.id)

  const { data: connectionList, isLoading, isError } = useWorkspaceConnections(activeWorkspace?.id)

  const remove = useMutation({
    mutationFn: (slug: string) =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/connections?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }).then(json),
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: key })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!activeWorkspace) return null
  const connections = connectionList ?? []

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-0.5 px-2 py-1">
        <p className="flex-1 text-[11px] uppercase tracking-wide text-muted-foreground">Connections</p>
        <button
          onClick={() => { setAdding(true); setError(null) }}
          title="Add a connection"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {connections.map((c) => (
        <div key={c.id} className="group relative flex items-start gap-1.5 rounded hover:bg-accent/40">
          {/* The row opens the configuration. The remove button is positioned
              over it rather than nested inside, since a button cannot contain
              another button. */}
          <button
            type="button"
            onClick={() => setViewing(c)}
            title={`${c.name} — view configuration`}
            className="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1.5 text-left cursor-pointer"
          >
            <Plug className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs truncate">{c.name}</span>
              <span className="block text-[10px] text-muted-foreground truncate">
                {c.kind === "rest" ? c.env?.token : "MCP"}
              </span>
            </span>
          </button>
          <button
            onClick={() => remove.mutate(c.slug)}
            className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive cursor-pointer"
            title="Remove"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      {/* A failed load used to render as "None yet.", which is how a workspace
          with two connections could look like one with none. */}
      {!isLoading && isError && (
        <p className="px-2 py-1.5 text-xs text-destructive">
          Could not load connections.
        </p>
      )}

      {!isLoading && !isError && connections.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">None yet.</p>
      )}

      {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}

      <WorkspaceConnectionDialog open={adding} onClose={() => setAdding(false)} />
      <WorkspaceConnectionDetail
        connection={viewing}
        envKeys={envKeys}
        onClose={() => setViewing(null)}
      />
    </div>
  )
}
