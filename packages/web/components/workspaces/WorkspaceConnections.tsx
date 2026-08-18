"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plug, Plus, Trash2, X } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { cn } from "@/lib/utils"

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

const AUTH_TYPES = ["none", "bearer", "header", "query", "basic"] as const

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

/**
 * What this workspace can reach: REST APIs and MCP servers.
 *
 * Secrets are write-only by design — the API never returns a value, so the form
 * shows whether one is set, never what it is. Re-entering replaces it.
 */
export function WorkspaceConnections() {
  const { activeWorkspace } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<"rest" | "mcp">("rest")
  const [form, setForm] = useState({
    name: "", description: "", baseUrl: "", authType: "bearer",
    authParam: "", mcpUrl: "", secret: "",
  })
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const key = ["workspace-connections", activeWorkspace?.id]

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/connections`).then(json<{ connections: Connection[] }>),
    enabled: !!activeWorkspace,
    retry: false,
  })

  const add = useMutation({
    mutationFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...form }),
      }).then(json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      setAdding(false); setError(null)
      setForm({ name: "", description: "", baseUrl: "", authType: "bearer", authParam: "", mcpUrl: "", secret: "" })
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (slug: string) =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/connections?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }).then(json),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => setError(e.message),
  })

  if (!activeWorkspace) return null
  const connections = data?.connections ?? []
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-0.5 px-2 py-1">
        <p className="flex-1 text-[11px] uppercase tracking-wide text-muted-foreground">Connections</p>
        <button
          onClick={() => { setAdding((v) => !v); setError(null) }}
          title="Add a connection"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {connections.map((c) => (
        <div key={c.id} className="group flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-accent/40">
          <Plug className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs truncate">{c.name}</span>
            <span className="block text-[10px] text-muted-foreground truncate">
              {c.kind === "rest" ? c.env?.token : "MCP"}
            </span>
          </span>
          <button
            onClick={() => remove.mutate(c.slug)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive cursor-pointer"
            title="Remove"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      {!isLoading && connections.length === 0 && !adding && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">None yet.</p>
      )}

      {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}

      {adding && (
        <form
          className="mt-1 p-2 rounded-lg border border-border bg-card space-y-1.5"
          onSubmit={(e) => { e.preventDefault(); add.mutate() }}
        >
          <div className="flex gap-1">
            {(["rest", "mcp"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "flex-1 text-[11px] py-1 rounded cursor-pointer",
                  kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                )}
              >
                {k === "rest" ? "REST API" : "MCP server"}
              </button>
            ))}
          </div>

          <input required placeholder="Name (e.g. Sunzi CRM)" value={form.name} onChange={set("name")}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
          <input placeholder="What is it for? (shown to the agent)" value={form.description} onChange={set("description")}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />

          {kind === "rest" ? (
            <>
              <input required placeholder="https://api.example.com" value={form.baseUrl} onChange={set("baseUrl")}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
              <select value={form.authType} onChange={set("authType")}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none">
                {AUTH_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {(form.authType === "header" || form.authType === "query") && (
                <input required placeholder={form.authType === "header" ? "X-Api-Key" : "api_key"}
                  value={form.authParam} onChange={set("authParam")}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
              )}
            </>
          ) : (
            <input required placeholder="https://mcp.example.com/mcp" value={form.mcpUrl} onChange={set("mcpUrl")}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
          )}

          {(kind === "mcp" || form.authType !== "none") && (
            <input type="password" placeholder="Secret / token" value={form.secret} onChange={set("secret")}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
          )}

          <button type="submit" disabled={add.isPending}
            className="w-full flex items-center justify-center gap-1.5 rounded bg-primary text-primary-foreground py-1 text-xs font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
            {add.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Add
          </button>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Stored encrypted. Never shown again, and never sent to the browser.
          </p>
        </form>
      )}
    </div>
  )
}
