"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../keys"

export interface ServerInfo {
  port: number
  url: string
}

/**
 * How often to look for new dev servers, by whether anything could plausibly
 * have started one.
 *
 * This poll is not cheap. Each tick costs three database queries, a Daytona
 * control-plane call and a remote `cat /proc/net/tcp` exec in the sandbox —
 * about two seconds of work — and it competes for the same connection pool as
 * everything the user is actually waiting on. At a flat five seconds it ran
 * forever against an idle sandbox where no port can appear without the agent
 * doing something.
 */
const ACTIVE_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 30_000

/**
 * Polls for listening dev servers in a sandbox.
 *
 * @param sandboxId - The sandbox to poll for servers
 * @param previewUrlPattern - URL pattern with {port} placeholder
 * @param active - The agent is running or a preview is already open, so a port
 *   could appear or disappear at any moment. When false the poll drops to a
 *   background heartbeat.
 */
export function useServersQuery(
  sandboxId: string | null | undefined,
  previewUrlPattern?: string | null,
  active = true
) {
  return useQuery({
    queryKey: queryKeys.sandbox.servers(sandboxId ?? ""),
    queryFn: async (): Promise<ServerInfo[]> => {
      if (!sandboxId) return []

      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, action: "list-servers" }),
      })

      if (!res.ok) {
        // Don't throw on polling failures - just return empty
        console.warn("Failed to fetch servers:", res.status)
        return []
      }

      const data = await res.json()
      const ports: number[] = Array.isArray(data.ports) ? data.ports : []

      return ports.map((port) => ({
        port,
        url: previewUrlPattern
          ? previewUrlPattern.replace("{port}", String(port))
          : `http://localhost:${port}`,
      }))
    },
    enabled: !!sandboxId,
    refetchInterval: active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
    // Just under the interval, so a remount reuses the last result instead of
    // firing an extra request on top of the scheduled one.
    staleTime: (active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS) - 1_000,
    retry: false, // Don't retry polling failures
    refetchOnWindowFocus: false,
  })
}
