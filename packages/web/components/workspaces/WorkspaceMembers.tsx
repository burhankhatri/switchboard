"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Loader2, X, Crown, User as UserIcon } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { cn } from "@/lib/utils"

interface Member {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  githubLogin: string | null
  role: string
  isYou: boolean
}

/**
 * Who is in this workspace, and how to add someone.
 *
 * This is the product in one panel: the person who built the workspace types a
 * teammate's GitHub username, and that teammate immediately has the skills, the
 * scripts and the credentials — no subscription of their own, no keys, nothing
 * to set up.
 */
export function WorkspaceMembers() {
  const { activeWorkspace } = useWorkspace()
  const wsId = activeWorkspace?.id
  const qc = useQueryClient()
  const [identifier, setIdentifier] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ["workspace-members", wsId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsId}/members`)
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as { members: Member[]; yourRole: string }
    },
    enabled: !!wsId,
    staleTime: 30_000,
    retry: false,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-members", wsId] })
    qc.invalidateQueries({ queryKey: ["workspaces"] })
  }

  const add = useMutation({
    mutationFn: async (who: string) => {
      const r = await fetch(`/api/workspaces/${wsId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: who }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? "Could not add them")
      return body as { added: boolean; alreadyMember?: boolean; member: Member }
    },
    onSuccess: (res) => {
      setIdentifier("")
      setError(null)
      setNote(
        res.alreadyMember
          ? `${res.member.name ?? "They"} is already in this workspace.`
          : `${res.member.name ?? res.member.githubLogin ?? "They"} can use this workspace now.`
      )
      invalidate()
    },
    onError: (e: Error) => {
      setNote(null)
      setError(e.message)
    },
  })

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const r = await fetch(`/api/workspaces/${wsId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? "Could not change their role")
      return body
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const r = await fetch(`/api/workspaces/${wsId}/members/${userId}`, { method: "DELETE" })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? "Could not remove them")
      return body
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  if (!wsId) return null
  const isOwner = data?.yourRole === "owner"

  return (
    <div className="px-2 pb-2">
      <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        People
      </p>

      {isPending && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {data?.members.map((m) => (
        <div
          key={m.userId}
          className="group flex items-center gap-2 rounded px-2 py-1 text-xs"
          style={{ animation: "fade-up 200ms var(--ease-spring) both" }}
        >
          {m.role === "owner" ? (
            <Crown className="h-3 w-3 shrink-0 text-primary" aria-label="Owner" />
          ) : (
            <UserIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Member" />
          )}
          <span className="min-w-0 flex-1 truncate text-foreground">
            {m.name ?? m.githubLogin ?? m.email}
            {m.isYou && <span className="ml-1 text-muted-foreground">(you)</span>}
          </span>

          {isOwner && !m.isYou && (
            <>
              <button
                onClick={() =>
                  setRole.mutate({ userId: m.userId, role: m.role === "owner" ? "member" : "owner" })
                }
                title={m.role === "owner" ? "Make a member" : "Make an owner"}
                className="opacity-0 group-hover:opacity-100 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-opacity"
              >
                {m.role === "owner" ? "demote" : "promote"}
              </button>
              <button
                onClick={() => remove.mutate(m.userId)}
                title="Remove from workspace"
                aria-label={`Remove ${m.name ?? m.githubLogin ?? "member"}`}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      ))}

      {isOwner && (
        <form
          className="mt-1 flex items-center gap-1 px-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (identifier.trim()) add.mutate(identifier.trim())
          }}
        >
          <input
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              setError(null)
              setNote(null)
            }}
            placeholder="GitHub username"
            aria-label="Add someone by GitHub username"
            className="min-w-0 flex-1 rounded-chip border border-line bg-field px-1.5 py-0.5 text-xs text-ink outline-none focus:border-line-strong placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={!identifier.trim() || add.isPending}
            title="Add to this workspace"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </form>
      )}

      {error && <p className="px-2 pt-1 text-[11px] text-destructive break-words">{error}</p>}
      {note && <p className="px-2 pt-1 text-[11px] text-primary break-words">{note}</p>}

      {isOwner && (
        <p className={cn("px-2 pt-2 text-[10px] leading-snug text-muted-foreground/70")}>
          Anyone you add gets this workspace&apos;s skills, scripts and connections
          straight away — they need no subscription and no keys of their own.
        </p>
      )}
    </div>
  )
}
