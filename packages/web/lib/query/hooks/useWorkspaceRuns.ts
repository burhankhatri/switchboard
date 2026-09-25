"use client"

import { useQuery } from "@tanstack/react-query"
import type { TaskRun } from "@/components/agent/TaskRows"

type RunStatus = Pick<TaskRun, "status">

export const workspaceRunsKey = (workspaceId: string | undefined) =>
  ["workspace-runs", workspaceId] as const

export function hasActiveRun(runs: RunStatus[]): boolean {
  return runs.some((r) => r.status === "running" || r.status === "pending")
}

/** Poll while a run is in flight so it finishes on screen; otherwise stay quiet. */
export function workspaceRunsPollInterval(runs: RunStatus[]): number | false {
  return hasActiveRun(runs) ? 5_000 : false
}

/**
 * Recent scheduled runs for a workspace. One cache slot shared by the Runs
 * panel and the rail's in-progress dot, so showing both costs one poll.
 */
export function useWorkspaceRuns(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceRunsKey(workspaceId),
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceId}/runs?limit=10`).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ runs: TaskRun[] }>
      }),
    enabled: !!workspaceId,
    retry: false,
    refetchInterval: (q) => workspaceRunsPollInterval(q.state.data?.runs ?? []),
  })
}
