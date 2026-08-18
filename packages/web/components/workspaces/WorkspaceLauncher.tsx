"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession, signIn } from "next-auth/react"
import { Plus, LogIn, Loader2, ArrowRight, Users, FolderGit2 } from "lucide-react"
import { BRAND } from "@/lib/brand"
import { cn } from "@/lib/utils"

export interface WorkspaceSummary {
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
 * The home screen. Workspaces are the product, so they are the first thing on
 * it — not a control tucked into a header. Composing a message comes after
 * choosing where that message runs, because the workspace decides which skills,
 * scripts and connections exist.
 */
export function WorkspaceLauncher({
  onOpen,
}: {
  onOpen?: (workspace: WorkspaceSummary) => void
}) {
  const { status } = useSession()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  // Three states, not two. Collapsing "loading" into "signed out" is what makes
  // a refresh flash the sign-in card before the session resolves.
  const signedIn = status === "authenticated"
  const resolving = status === "loading"

  const { data, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetch("/api/workspaces").then(json<{ workspaces: WorkspaceSummary[] }>),
    enabled: signedIn,
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
      setCreating(false); setName(""); setSystemPrompt(""); setError(null)
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
    <div className="w-full max-w-3xl mx-auto px-6 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-foreground">{BRAND.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{BRAND.tagline}</p>
      </header>

      {resolving ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading workspaces">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[76px] rounded-xl border border-border bg-card/40 animate-pulse" />
          ))}
        </div>
      ) : !signedIn ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Sign in to see your team&apos;s workspaces.
          </p>
          <button
            onClick={() => signIn("github")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 cursor-pointer"
          >
            Sign in with GitHub
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-lg text-foreground">{BRAND.launcherHeading}</h2>
            {!creating && (
              <button
                onClick={() => { setCreating(true); setError(null) }}
                className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-border px-3 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> New workspace
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-5">{BRAND.launcherSubheading}</p>

          {creating && (
            <form
              className="rounded-xl border border-border bg-card p-4 mb-6 space-y-3"
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 resize-none"
                />
              </label>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={create.isPending || !name.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create workspace
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setError(null) }}
                  className="rounded-lg px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Creates a folder in the private workspaces repo with a starter skill. Add
                scripts and skills to it and every run picks them up.
              </p>
            </form>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
            </div>
          )}

          {!isLoading && mine.length === 0 && others.length === 0 && !creating && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No workspaces yet. Create the first one.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            {mine.map((w) => (
              <button
                key={w.id}
                onClick={() => onOpen?.(w)}
                className={cn(
                  "group text-left rounded-xl border border-border bg-card p-4",
                  "hover:border-primary/50 hover:bg-accent/40 transition-colors cursor-pointer"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-base text-foreground">{w.name}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FolderGit2 className="h-3 w-3" /> {w.path}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> {w.memberCount}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5">{w.agent}</span>
                </div>
              </button>
            ))}
          </div>

          {others.length > 0 && (
            <>
              <h2 className="font-display text-lg text-foreground mt-8 mb-3">
                Available to join
              </h2>
              <div className="grid gap-2">
                {others.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-base text-foreground truncate">
                        {w.name}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <button
                      onClick={() => join.mutate(w.id)}
                      disabled={join.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 cursor-pointer"
                    >
                      <LogIn className="h-3.5 w-3.5" /> Join
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
