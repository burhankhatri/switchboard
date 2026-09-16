"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Sparkles } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import {
  useWorkspaceSkills,
  workspaceSkillsKey,
} from "@/lib/query/hooks/useWorkspaceSkills"
import { skillSlug } from "@/lib/workspace-skills"
import { cn } from "@/lib/utils"

/**
 * The skills a workspace carries — the first thing in the panel, because it is
 * the thing people came for.
 *
 * A skill is a folder at `.claude/skills/<slug>/SKILL.md`, and that path is
 * what makes the agent find it. Adding one here sends a name and a description
 * and lets the server work out the path, so nobody has to know the convention
 * to add knowledge to a workspace. The files underneath are still there, one
 * disclosure down, for whoever does.
 */
export function WorkspaceSkills() {
  const { activeWorkspace, openFile, requestOpenFile } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data, isLoading, isError } = useWorkspaceSkills(activeWorkspace?.id)

  const create = useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      const res = await fetch(`/api/workspaces/${activeWorkspace!.id}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Could not add the skill")
      }
      return res.json() as Promise<{ skill: { path: string } }>
    },
    onSuccess: ({ skill }) => {
      close()
      // The file list gains a file too, and a run clones the tree — both slots
      // are stale the moment this commits.
      qc.invalidateQueries({ queryKey: workspaceSkillsKey(activeWorkspace?.id) })
      qc.invalidateQueries({ queryKey: ["workspace-files", activeWorkspace?.id] })
      // Straight into the editor: a scaffold nobody fills in is worse than no
      // skill, since the agent will read it and learn the placeholder.
      void requestOpenFile(skill.path)
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!activeWorkspace) return null
  const skills = data?.skills ?? []

  function close() {
    setAdding(false)
    setName("")
    setDescription("")
    setError(null)
  }

  function open() {
    setAdding(true)
    setError(null)
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  function submit() {
    if (create.isPending) return
    if (!name.trim()) return setError("Give the skill a name")
    if (!skillSlug(name)) return setError("Use some letters or numbers in the name")
    if (!description.trim()) return setError("Say when the agent should use it")
    create.mutate({ name: name.trim(), description: description.trim() })
  }

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-0.5 px-2 py-1">
        <p className="flex-1 text-[11px] uppercase tracking-wide text-muted-foreground">Skills</p>
        <button
          onClick={() => (adding ? close() : open())}
          title="Add a skill"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Plus className={cn("h-3.5 w-3.5 transition-transform", adding && "rotate-45")} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {/* A failed load must not read as an empty workspace — someone would add
          a second copy of a skill that is already there. */}
      {!isLoading && isError && (
        <p className="px-2 py-1.5 text-xs text-destructive">Could not load skills.</p>
      )}

      {skills.map((s) => (
        <button
          key={s.slug}
          onClick={() => void requestOpenFile(s.path)}
          title={s.description || s.name}
          className={cn(
            "flex w-full items-start gap-1.5 rounded px-2 py-1.5 text-left cursor-pointer",
            openFile === s.path ? "bg-accent" : "hover:bg-accent/50"
          )}
        >
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">{s.name}</span>
            <span
              className={cn(
                "block truncate text-[10px]",
                s.description ? "text-muted-foreground" : "text-destructive"
              )}
            >
              {/* No description means the agent has nothing to match a task
                  against, so it is a fault to fix rather than a blank line. */}
              {s.description || "No description — the agent cannot tell when to use this"}
            </span>
          </span>
        </button>
      ))}

      {!isLoading && !isError && skills.length === 0 && !adding && (
        <p className="px-2 py-2 text-xs leading-snug text-muted-foreground">
          No skills yet. Add one and every run of this workspace picks it up.
        </p>
      )}

      {adding && (
        <div
          className="space-y-1.5 px-2 py-1.5"
          style={{ animation: "fade-up 200ms var(--ease-spring) both" }}
        >
          <input
            ref={nameInput}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                close()
              }
            }}
            placeholder="Campaign audit"
            aria-label="Skill name"
            className="w-full rounded-chip border border-line bg-field px-1.5 py-1 text-xs text-ink outline-none focus:border-line-strong placeholder:text-ink-3"
          />
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                close()
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={2}
            placeholder="When should the agent use this?"
            aria-label="When the agent should use this skill"
            className="w-full resize-none rounded-chip border border-line bg-field px-1.5 py-1 text-xs text-ink outline-none focus:border-line-strong placeholder:text-ink-3"
          />
          {name.trim() && (
            <p className="text-[10px] text-muted-foreground">
              Saved as <code>.claude/skills/{skillSlug(name) || "…"}/SKILL.md</code>
            </p>
          )}
          <button
            onClick={submit}
            disabled={create.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-chip bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60 cursor-pointer"
          >
            {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {create.isPending ? "Committing…" : "Add skill"}
          </button>
        </div>
      )}

      {error && <p className="px-2 pb-1 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
