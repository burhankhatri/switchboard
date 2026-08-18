"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Loader2, X, Crown, User as UserIcon, Users } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import { dialogIconClass } from "@/components/ui/dialog-parts"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useMobile } from "@/lib/hooks/useMobile"

interface Member {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  githubLogin: string | null
  role: string
  isYou: boolean
}

interface WorkspaceMembersDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Who is in this workspace, and how to add someone.
 *
 * Members belong to the workspace as a whole, so this lives in a dialog
 * launched from the workspace selector rather than another sidebar section.
 * Adding someone by GitHub username gives them the skills, scripts and
 * connections immediately — no subscription of their own, no keys.
 */
export function WorkspaceMembersDialog({ open, onClose }: WorkspaceMembersDialogProps) {
  const { activeWorkspace } = useWorkspace()
  const isMobile = useMobile()
  const wsId = activeWorkspace?.id
  const qc = useQueryClient()
  const [identifier, setIdentifier] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setIdentifier("")
    setError(null)
    setNote(null)
  }, [open])

  const { data, isPending } = useQuery({
    queryKey: ["workspace-members", wsId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsId}/members`)
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as { members: Member[]; yourRole: string }
    },
    enabled: !!wsId && open,
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
    <BaseDialog
      open={open}
      onClose={onClose}
      title="People"
      icon={<Users className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
    >
      <div className="space-y-3">
        {isPending && (
          <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        <div className="space-y-0.5">
          {data?.members.map((m) => (
            <div
              key={m.userId}
              className="group flex items-center gap-2 rounded-md px-1 py-1.5 text-sm"
            >
              {m.role === "owner" ? (
                <Crown className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Owner" />
              ) : (
                <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Member" />
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
                    className="opacity-0 group-hover:opacity-100 rounded px-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-opacity"
                  >
                    {m.role === "owner" ? "demote" : "promote"}
                  </button>
                  <button
                    onClick={() => remove.mutate(m.userId)}
                    title="Remove from workspace"
                    aria-label={`Remove ${m.name ?? m.githubLogin ?? "member"}`}
                    className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <form
            className="flex items-center gap-1.5 pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (identifier.trim()) add.mutate(identifier.trim())
            }}
          >
            <Input
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value)
                setError(null)
                setNote(null)
              }}
              placeholder="GitHub username"
              aria-label="Add someone by GitHub username"
            />
            <button
              type="submit"
              disabled={!identifier.trim() || add.isPending}
              title="Add to this workspace"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >
              {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </form>
        )}

        {error && <p className="text-xs text-destructive break-words">{error}</p>}
        {note && <p className="text-xs text-primary break-words">{note}</p>}

        {isOwner && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Anyone you add gets this workspace&apos;s skills, scripts and connections
            straight away — they need no subscription and no keys of their own.
          </p>
        )}
      </div>
    </BaseDialog>
  )
}
