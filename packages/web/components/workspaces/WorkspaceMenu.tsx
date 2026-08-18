"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Boxes, Check, Plus, LogIn, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface WorkspaceSummary {
  id: string
  slug: string
  name: string
  path: string
  agent: string
  systemPrompt: string | null
  memberCount: number
  chatCount: number
  joined: boolean
  role: string | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

/**
 * Top-right workspace switcher: create a new workspace, or join one someone
 * else already built. Creating commits a folder to the private workspaces repo
 * and returns immediately — the repo is the source of truth, the row is an index
 * over it.
 */
export function WorkspaceMenu({ onSelect }: { onSelect?: (w: WorkspaceSummary) => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"list" | "create">("list")
  const [name, setName] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetch("/api/workspaces").then(json<{ workspaces: WorkspaceSummary[] }>),
    enabled: open,
    retry: false,
  })

  const create = useMutation({
    mutationFn: (body: { name: string; systemPrompt?: string }) =>
      fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(json<{ workspace: WorkspaceSummary }>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] })
      setMode("list"); setName(""); setSystemPrompt(""); setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const join = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/workspaces/${id}/membership`, { method: "POST" }).then(json),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
    onError: (e: Error) => setError(e.message),
  })

  const workspaces = data?.workspaces ?? []
  const mine = workspaces.filter((w) => w.joined)
  const others = workspaces.filter((w) => !w.joined)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        title="Workspaces"
        aria-label="Workspaces"
        aria-expanded={open}
      >
        <Boxes className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-9 z-50 w-80 rounded-lg border border-border bg-popover shadow-lg p-1.5">
            {mode === "list" ? (
              <>
                {isLoading && (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                )}

                {mine.length > 0 && (
                  <div className="px-2 pt-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Your workspaces
                  </div>
                )}
                {mine.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => { onSelect?.(w); setOpen(false) }}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm truncate">{w.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {w.path} · {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                ))}

                {others.length > 0 && (
                  <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Available to join
                  </div>
                )}
                {others.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{w.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <button
                      onClick={() => join.mutate(w.id)}
                      disabled={join.isPending}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer disabled:opacity-50"
                    >
                      <LogIn className="h-3 w-3" /> Join
                    </button>
                  </div>
                ))}

                {loadError && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    Sign in with GitHub to see workspaces.
                  </p>
                )}

                {!isLoading && !loadError && workspaces.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    No workspaces yet. Create the first one.
                  </p>
                )}

                {!loadError && (
                  <div className="mt-1 pt-1 border-t border-border">
                    <button
                      onClick={() => { setMode("create"); setError(null) }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left text-sm cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" /> New workspace
                    </button>
                  </div>
                )}
              </>
            ) : (
              <form
                className="p-1.5 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim()) return
                  create.mutate({ name: name.trim(), systemPrompt: systemPrompt.trim() || undefined })
                }}
              >
                <label className="block">
                  <span className="block text-xs text-muted-foreground mb-1">Name</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Marketing Automation"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-muted-foreground mb-1">
                    System prompt <span className="opacity-60">(optional)</span>
                  </span>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={4}
                    placeholder="How work is done in this workspace…"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </label>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="submit"
                    disabled={create.isPending || !name.trim()}
                    className={cn(
                      "flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md cursor-pointer",
                      "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    )}
                  >
                    {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode("list"); setError(null) }}
                    className="text-sm px-2.5 py-1.5 rounded-md hover:bg-accent cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Creates a folder in the private workspaces repo with a starter skill.
                  Add scripts and skills to it and every run picks them up.
                </p>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
