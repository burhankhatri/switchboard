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
 * How often to poll, or false to stop.
 *
 * The idle case used to be a 30s heartbeat that ran whenever the open chat had
 * a sandbox, which is what a database bill is actually made of: Neon suspends a
 * compute after five minutes without a query, and three queries every thirty
 * seconds means it never suspends. A tab left open overnight billed .25-2 CU
 * for the whole night while nobody was using the app.
 *
 * Polling an idle sandbox never had a payoff either — a dev server cannot
 * appear unless the agent does something, and when it starts, `active` goes
 * true and the fast poll resumes. So the only reason to watch while idle is a
 * preview already on screen, whose server can stop under the user.
 */
export function serversPollInterval({
  active,
  previewOpen,
}: {
  active: boolean
  previewOpen: boolean
}): number | false {
  if (active) return ACTIVE_INTERVAL_MS
  if (previewOpen) return IDLE_INTERVAL_MS
  return false
}

/**
 * Polls for listening dev servers in a sandbox.
 *
 * @param sandboxId - The sandbox to poll for servers
 * @param previewUrlPattern - URL pattern with {port} placeholder
 * @param active - The agent is running, so a port could appear or disappear at
 *   any moment.
 * @param previewOpen - A preview pane is on screen, so a server that stops has
 *   to be noticed. With neither set the poll stops entirely; see
 *   {@link serversPollInterval} for why that matters to the bill.
 */
export function useServersQuery(
  sandboxId: string | null | undefined,
  previewUrlPattern?: string | null,
  active = true,
  previewOpen = false
) {
  const interval = serversPollInterval({ active, previewOpen })
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
    refetchInterval: interval,
    // Just under the interval, so a remount reuses the last result instead of
    // firing an extra request on top of the scheduled one.
    staleTime: (interval === false ? IDLE_INTERVAL_MS : interval) - 1_000,
    retry: false, // Don't retry polling failures
    refetchOnWindowFocus: false,
  })
}
