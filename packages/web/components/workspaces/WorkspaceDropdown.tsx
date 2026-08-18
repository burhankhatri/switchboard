"use client"

import { useRef, useState, useLayoutEffect, useEffect } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Boxes,
  Check,
  ChevronDown,
  LogIn,
  Loader2,
  Plus,
  ArrowRight,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkspace, type ActiveWorkspace } from "@/lib/contexts/WorkspaceContext"
import { WorkspaceCreatingPanel } from "./WorkspaceCreatingPanel"
import { WorkspaceMembersDialog } from "./WorkspaceMembers"

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

interface WorkspaceDropdownProps {
  /** When collapsed, show only the icon. */
  collapsed?: boolean
  /** Extra class names for the wrapper. */
  className?: string
}

/**
 * Inline sidebar workspace selector.
 *
 * Always visible at the top of the sidebar. Shows the active workspace name
 * (or a placeholder) and opens a popover to switch, join, or create workspaces.
 * People live here too — membership is a property of the workspace, not another
 * scrolling sidebar section.
 */
export function WorkspaceDropdown({ collapsed = false, className }: WorkspaceDropdownProps) {
  const { activeWorkspace, setActiveWorkspace } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [mode, setMode] = useState<"list" | "create">("list")
  const [name, setName] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Anchors the portalled panel; it cannot position itself relative to a
  // parent it deliberately escapes.
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
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
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] })
      // Auto-select the newly created workspace
      const w = res.workspace
      setActiveWorkspace({ id: w.id, slug: w.slug, name: w.name, path: w.path, agent: w.agent })
      setMode("list")
      setName("")
      setSystemPrompt("")
      setError(null)
      setCreateStartedAt(null)
      setOpen(false)
    },
    onError: (e: Error) => {
      setCreateStartedAt(null)
      setError(e.message)
    },
  })

  const join = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/workspaces/${id}/membership`, { method: "POST" }).then(json),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
    onError: (e: Error) => setError(e.message),
  })

  // The panel is portalled to body, so clicks inside it are "outside" wrapperRef.
  // Creating a workspace is a 10–30s GitHub commit — do not dismiss that wait.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      if (create.isPending) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, create.isPending])

  const workspaces = data?.workspaces ?? []
  const mine = workspaces.filter((w) => w.joined)
  const others = workspaces.filter((w) => !w.joined)

  function selectWorkspace(w: WorkspaceSummary) {
    const ws: ActiveWorkspace = { id: w.id, slug: w.slug, name: w.name, path: w.path, agent: w.agent }
    setActiveWorkspace(ws)
    setOpen(false)
  }

  function openPeople() {
    setOpen(false)
    setPeopleOpen(true)
  }

  useEffect(() => {
    if (!activeWorkspace) setPeopleOpen(false)
  }, [activeWorkspace])

  const peopleDialog = (
    <WorkspaceMembersDialog open={peopleOpen} onClose={() => setPeopleOpen(false)} />
  )

  // ── Collapsed state: just a Boxes icon ──────────────────────────────────
  if (collapsed) {
    return (
      <div ref={wrapperRef} className={cn("relative flex justify-center", className)}>
        <button
          ref={triggerRef as React.RefObject<HTMLButtonElement>}
          onClick={() => {
            if (create.isPending) return
            setOpen((v) => !v)
          }}
          className={cn(
            "p-1.5 rounded-md transition-colors cursor-pointer",
            activeWorkspace
              ? "text-primary hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={activeWorkspace ? activeWorkspace.name : "Select workspace"}
          aria-label="Workspaces"
          aria-expanded={open}
        >
          <Boxes className="h-4 w-4" />
        </button>

        {open && <DropdownPanel
          mode={mode} setMode={setMode}
          name={name} setName={setName}
          systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
          error={error} setError={setError}
          isLoading={isLoading} loadError={loadError}
          mine={mine} others={others}
          activeWorkspace={activeWorkspace}
          create={create} join={join}
          createStartedAt={createStartedAt}
          setCreateStartedAt={setCreateStartedAt}
          selectWorkspace={selectWorkspace}
          onOpenPeople={openPeople}
          side="left"
          anchorRef={triggerRef}
          panelRef={panelRef}
        />}
        {peopleDialog}
      </div>
    )
  }

  // ── Expanded state: full-width trigger ──────────────────────────────────
  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <div className="flex items-center gap-0.5">
        <button
          ref={triggerRef as React.RefObject<HTMLButtonElement>}
          onClick={() => {
            if (create.isPending) return
            setOpen((v) => !v)
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            "min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer group",
            "hover:bg-accent/60",
            open && "bg-accent/40"
          )}
        >
          <Boxes className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            activeWorkspace ? "text-primary" : "text-muted-foreground"
          )} />
          <span className="min-w-0 flex-1 text-left">
            {activeWorkspace ? (
              <span className="block text-sm font-medium truncate">{activeWorkspace.name}</span>
            ) : (
              <span className="block text-sm text-muted-foreground">Select workspace</span>
            )}
          </span>
          <ChevronDown className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )} />
        </button>
        {activeWorkspace && (
          // Members belong to the workspace, not the file tree.
          <button
            type="button"
            onClick={openPeople}
            title="People"
            aria-label="People in this workspace"
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors cursor-pointer"
          >
            <Users className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && <DropdownPanel
        mode={mode} setMode={setMode}
        name={name} setName={setName}
        systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
        error={error} setError={setError}
        isLoading={isLoading} loadError={loadError}
        mine={mine} others={others}
        activeWorkspace={activeWorkspace}
        create={create} join={join}
        createStartedAt={createStartedAt}
        setCreateStartedAt={setCreateStartedAt}
        selectWorkspace={selectWorkspace}
        onOpenPeople={openPeople}
        side="bottom"
        anchorRef={wrapperRef}
        panelRef={panelRef}
      />}
      {peopleDialog}
    </div>
  )
}

// ── Shared popover panel ──────────────────────────────────────────────────

interface PanelProps {
  mode: "list" | "create"
  setMode: (m: "list" | "create") => void
  name: string
  setName: (v: string) => void
  systemPrompt: string
  setSystemPrompt: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  isLoading: boolean
  loadError: Error | null
  mine: WorkspaceSummary[]
  others: WorkspaceSummary[]
  activeWorkspace: ActiveWorkspace | null
  create: ReturnType<typeof useMutation<{ workspace: WorkspaceSummary }, Error, { name: string; systemPrompt?: string }>>
  join: ReturnType<typeof useMutation<unknown, Error, string>>
  createStartedAt: number | null
  setCreateStartedAt: (t: number | null) => void
  selectWorkspace: (w: WorkspaceSummary) => void
  onOpenPeople: () => void
  side: "bottom" | "left"
  anchorRef: React.RefObject<HTMLElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
}

function DropdownPanel({
  mode, setMode, name, setName, systemPrompt, setSystemPrompt,
  error, setError, isLoading, loadError, mine, others,
  activeWorkspace, create, join, createStartedAt, setCreateStartedAt,
  selectWorkspace, onOpenPeople, side, anchorRef, panelRef,
}: PanelProps) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  // The panel is portalled to <body> and positioned from the trigger's rect
  // rather than being absolutely positioned inside the sidebar.
  //
  // The sidebar carries backdrop-filter for the glass effect, and an element
  // with a backdrop-filter clips its descendants to its own bounds — so an
  // in-sidebar absolute panel was cut off mid-word. Escaping the sidebar is the
  // only fix that keeps both the glass and the full panel. Width follows the
  // trigger in the expanded sidebar so the menu does not spill into the main
  // pane; collapsed mode still opens a full-width panel to the right of the icon.
  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      const width = side === "bottom" ? r.width : 288
      const top = side === "bottom" ? r.bottom + 4 : r.top
      const left = side === "bottom" ? r.left : r.right + 4
      setPos({
        top: Math.min(top, window.innerHeight - 120),
        // Keep it on screen if the trigger sits near the right edge.
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        width,
      })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [anchorRef, side])

  if (!pos) return null

  return createPortal(
    <div
      ref={panelRef}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      className={cn(
        "fixed z-[100] rounded-lg border border-border bg-popover shadow-xl py-1",
        "max-h-[min(420px,calc(100vh-8rem))] overflow-y-auto"
      )}
    >
      {mode === "list" ? (
        <>
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}

          {loadError && (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Sign in with GitHub to see workspaces.
            </p>
          )}

          {mine.length > 0 && (
            <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Your workspaces
            </p>
          )}

          {mine.map((w) => {
            const isActive = activeWorkspace?.id === w.id
            return (
              <button
                key={w.id}
                onClick={() => selectWorkspace(w)}
                className={cn(
                  "group w-full flex items-start gap-2.5 px-3 py-2 hover:bg-accent text-left cursor-pointer transition-colors",
                  isActive && "bg-accent/50"
                )}
              >
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0">
                  {isActive
                    ? <Check className="h-3.5 w-3.5 text-primary" />
                    : <ArrowRight className="h-3.5 w-3.5 text-transparent group-hover:text-muted-foreground transition-colors" />
                  }
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm truncate", isActive && "font-medium text-primary")}>
                    {w.name}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {w.path} · {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            )
          })}

          {others.length > 0 && (
            <>
              <div className="mx-3 my-1 border-t border-border" />
              <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Available to join
              </p>
              {others.map((w) => (
                <div key={w.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50">
                  <span className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{w.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    onClick={() => join.mutate(w.id)}
                    disabled={join.isPending}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <LogIn className="h-3 w-3" /> Join
                  </button>
                </div>
              ))}
            </>
          )}

          {!isLoading && !loadError && mine.length === 0 && others.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No workspaces yet. Create the first one.
            </p>
          )}

          {!loadError && (
            <>
              <div className="mx-3 my-1 border-t border-border" />
              {activeWorkspace && (
                <button
                  onClick={onOpenPeople}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left cursor-pointer transition-colors"
                >
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  People
                </button>
              )}
              <button
                onClick={() => { setMode("create"); setError(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left cursor-pointer transition-colors"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                New workspace
              </button>
            </>
          )}
        </>
      ) : create.isPending ? (
        <WorkspaceCreatingPanel
          name={name.trim()}
          startedAt={createStartedAt ?? undefined}
          className="m-2 border-0 shadow-none"
        />
      ) : (
        <form
          className="p-3 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            setCreateStartedAt(Date.now())
            create.mutate({ name: name.trim(), systemPrompt: systemPrompt.trim() || undefined })
          }}
        >
          <p className="text-sm font-medium">New workspace</p>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marketing Automation"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              System prompt <span className="opacity-60">(optional)</span>
            </span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="How work is done in this workspace…"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40 resize-none"
            />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setMode("list"); setError(null) }}
              disabled={create.isPending}
              className="text-sm px-3 py-1.5 rounded-md hover:bg-accent cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Creates a folder in the private workspaces repo with a starter skill.
          </p>
        </form>
      )}
    </div>,
    document.body
  )
}
