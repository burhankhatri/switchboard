"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

export interface NotificationItem {
  id: string
  kind: "workspace_member_added" | "workspace_member_removed" | "agent_needs_input"
  title: string
  body: string | null
  chatId: string | null
  workspaceId: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationsResponse {
  notifications: NotificationItem[]
  unreadCount: number
}

export const notificationsKey = ["notifications"] as const

/**
 * How often to refresh the bell, or false to stop.
 *
 * Extracted and tested because getting it wrong costs money rather than
 * breaking anything. Neon suspends a compute after five minutes without a
 * query, so any recurring poll under that keeps the database awake 24/7 and
 * bills for it — the same mechanism that made `agent-lifecycle` at 60s cost
 * about $18 in a month of finding nothing.
 *
 * Polling therefore requires someone to actually be looking: a visible tab that
 * nobody has focused is a laptop left open overnight, not a reader. Coming back
 * to the tab refetches immediately via refetchOnWindowFocus, so the interval
 * only has to cover a session someone is sitting in front of.
 */
const FOCUSED_INTERVAL_MS = 60_000

export function notificationsPollInterval({
  visible,
  focused,
}: {
  visible: boolean
  focused: boolean
}): number | false {
  if (!visible || !focused) return false
  return FOCUSED_INTERVAL_MS
}

/** Tracks visibility and focus so the interval above has real inputs. */
function useTabPresence(): { visible: boolean; focused: boolean } {
  const [presence, setPresence] = useState(() => ({
    visible: typeof document === "undefined" ? false : !document.hidden,
    focused: typeof document === "undefined" ? false : document.hasFocus(),
  }))

  useEffect(() => {
    const update = () =>
      setPresence({ visible: !document.hidden, focused: document.hasFocus() })
    update()
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    return () => {
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
    }
  }, [])

  return presence
}

async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await fetch("/api/notifications")
  if (!res.ok) throw new Error("Failed to load notifications")
  return res.json()
}

export function useNotificationsQuery() {
  const { visible, focused } = useTabPresence()

  return useQuery({
    queryKey: notificationsKey,
    queryFn: fetchNotifications,
    refetchInterval: notificationsPollInterval({ visible, focused }),
    // The cheap half of staying current: returning to the tab refetches once,
    // instead of a timer running while nobody was there.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids?.length ? { ids } : {}),
      })
      if (!res.ok) throw new Error("Failed to mark notifications read")
      return res.json() as Promise<{ updated: number; unreadCount: number }>
    },
    onSuccess: (data) => {
      // Patch the count rather than refetching: the list the user is looking at
      // is still correct, only the badge changed.
      queryClient.setQueryData<NotificationsResponse>(notificationsKey, (prev) =>
        prev ? { ...prev, unreadCount: data.unreadCount } : prev
      )
    },
  })
}
