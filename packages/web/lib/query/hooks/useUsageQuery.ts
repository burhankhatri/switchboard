"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { UsageResponse } from "@/app/api/user/usage/route"

/**
 * Today's shared-pool usage, for the composer's budget line.
 *
 * No interval: a budget moves only when a turn finishes, and the composer
 * invalidates this key then. Refetching on focus covers someone coming back to
 * the tab. Anything that polled would keep the database awake (see
 * useNotificationsQuery for the cost of that).
 */
export const USAGE_STALE_MS = 5 * 60_000

async function fetchUsage(): Promise<UsageResponse> {
  const res = await fetch("/api/user/usage")
  if (!res.ok) throw new Error(`Failed to load usage (${res.status})`)
  return (await res.json()) as UsageResponse
}

export function useUsageQuery() {
  const { status } = useSession()
  return useQuery({
    queryKey: queryKeys.usage.all,
    queryFn: fetchUsage,
    enabled: status === "authenticated",
    staleTime: USAGE_STALE_MS,
    refetchInterval: false,
    refetchOnWindowFocus: true,
  })
}
