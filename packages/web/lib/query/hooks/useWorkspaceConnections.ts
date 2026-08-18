"use client"

import { useQuery } from "@tanstack/react-query"

export interface WorkspaceConnection {
  id: string
  kind: "rest" | "mcp"
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

/** What the endpoint returns, and the only shape ever written to the cache. */
export interface WorkspaceConnectionsResponse {
  connections: WorkspaceConnection[]
}

/**
 * The cache slot both the sidebar panel and the composer's @ menu read.
 *
 * A query key is a slot, not a namespace. When these two had their own queryFns
 * under this one key — one storing the response object, one storing the bare
 * array — whichever ran last decided what the other read. Saving a connection
 * invalidated the slot, the composer refilled it with an array, and the panel's
 * `data.connections` went undefined: it showed "None yet." while the server was
 * returning every connection. Sharing the fetcher below is what makes that
 * impossible, so prefer it over writing a new queryFn against this key.
 */
export const workspaceConnectionsKey = (workspaceId: string | undefined) =>
  ["workspace-connections", workspaceId] as const

export async function fetchWorkspaceConnections(
  workspaceId: string
): Promise<WorkspaceConnectionsResponse> {
  const res = await fetch(`/api/workspaces/${workspaceId}/connections`)
  if (!res.ok) {
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? res.statusText
    )
  }
  return res.json()
}

/**
 * Narrow the cached response to the list.
 *
 * Tolerates a bare array because a tab open across a deploy keeps the slot an
 * older build filled. The shape that caused the outage must degrade quietly,
 * not blank the panel again.
 */
export function selectConnections(
  data: WorkspaceConnectionsResponse | WorkspaceConnection[] | undefined
): WorkspaceConnection[] {
  if (Array.isArray(data)) return data
  return data?.connections ?? []
}

/** The connections of a workspace, for anything that needs the list. */
export function useWorkspaceConnections(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceConnectionsKey(workspaceId),
    queryFn: () => fetchWorkspaceConnections(workspaceId!),
    select: selectConnections,
    enabled: !!workspaceId,
    staleTime: 60_000,
    retry: false,
  })
}
