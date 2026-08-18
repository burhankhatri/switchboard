"use client"

import { useQuery } from "@tanstack/react-query"

export interface OverviewConnection {
  id: string
  kind: string
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

export interface OverviewMember {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  githubLogin: string | null
  role: string
  joinedAt: string
  isYou: boolean
}

export interface OverviewRun {
  id: string
  status: string
  startedAt: string
  completedAt: string | null
}

export interface WorkspaceOverview {
  yourRole: string
  connections: OverviewConnection[]
  members: OverviewMember[]
  runs: OverviewRun[]
}

/**
 * One request for the connections, people and runs panels.
 *
 * All three sidebar panels mount together when a workspace opens. Fetching
 * separately meant three sessions resolved, three membership checks and three
 * queries against a cross-region database, running concurrently and therefore
 * queueing on the connection pool. Sharing a query key means they share the
 * request and the cache entry — React Query dedupes the concurrent mounts.
 */
export function useWorkspaceOverview(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-overview", workspaceId],
    queryFn: async (): Promise<WorkspaceOverview> => {
      const r = await fetch(`/api/workspaces/${workspaceId}/overview`)
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
  })
}

/** Query key for cache invalidation after a mutation touches any of it. */
export const workspaceOverviewKey = (workspaceId: string | undefined) =>
  ["workspace-overview", workspaceId] as const
