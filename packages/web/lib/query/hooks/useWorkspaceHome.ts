import { useQuery } from "@tanstack/react-query"
import type { WorkspaceHome } from "@/lib/workspace-home/home"

export const workspaceHomeKey = (workspaceId: string | undefined) =>
  ["workspace-home", workspaceId] as const

/**
 * Everything on the home page except the brief. Refetched on focus and once a
 * minute while open, which is as live as a page people glance at needs to be;
 * the server debounces the last-visit time so refetching does not erase the
 * "since you were last here" summary.
 */
export function useWorkspaceHome(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceHomeKey(workspaceId),
    queryFn: async (): Promise<WorkspaceHome> => {
      const r = await fetch(`/api/workspaces/${workspaceId}/home`)
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })
}
