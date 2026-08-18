"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { TaskRows, type TaskRun } from "@/components/agent/TaskRows"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"

/**
 * Recent scheduled runs for the active workspace.
 *
 * Polls while anything is running so a finishing run updates without a manual
 * refresh, and stops once everything is settled rather than polling forever.
 */
export function WorkspaceRuns() {
  const { activeWorkspace } = useWorkspace()

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-runs", activeWorkspace?.id],
    queryFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/runs?limit=10`).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ runs: TaskRun[] }>
      }),
    enabled: !!activeWorkspace,
    retry: false,
    refetchInterval: (q) => {
      const runs = q.state.data?.runs ?? []
      const active = runs.some((r) => r.status === "running" || r.status === "pending")
      return active ? 5_000 : false
    },
  })

  if (!activeWorkspace) return null
  const runs = data?.runs ?? []

  // Nothing scheduled yet is the common case — an empty box adds noise.
  if (!isLoading && !error && runs.length === 0) return null

  return (
    <div className="px-2 pb-2">
      <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Runs</p>
      {isLoading && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="px-2 py-1.5 text-xs text-muted-foreground">Could not load runs.</p>}
      {runs.length > 0 && <TaskRows runs={runs} />}
    </div>
  )
}
