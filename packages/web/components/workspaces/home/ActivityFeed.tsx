"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  LayoutGrid,
  Loader2,
  MessageSquare,
  UserPlus,
  type LucideIcon,
} from "lucide-react"
import type { FeedEvent } from "@/lib/workspace-home/feed"
import { cn } from "@/lib/utils"
import { ago } from "./time"

const ICON: Record<string, LucideIcon> = {
  run_completed: CheckCircle2,
  run_failed: AlertTriangle,
  files_committed: FileText,
  chat_shared: MessageSquare,
  member_joined: UserPlus,
  member_left: UserPlus,
  widget_created: LayoutGrid,
  widget_updated: LayoutGrid,
  widget_removed: LayoutGrid,
}

export function FeedItem({
  event,
  onOpenChat,
}: {
  event: FeedEvent
  onOpenChat: (chatId: string) => void
}) {
  const Icon = ICON[event.kind] ?? CalendarClock
  // A scheduled run has no person behind it; the job name is in the summary.
  const who = event.actor?.name ?? (event.kind.startsWith("run_") ? null : "Someone")
  const body = (
    <>
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          event.kind === "run_failed" ? "text-destructive" : "text-ink-3"
        )}
      />
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
        {who && <span className="font-medium">{who} · </span>}
        {event.summary}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{ago(event.createdAt)}</span>
    </>
  )
  return event.chatId ? (
    <button
      onClick={() => onOpenChat(event.chatId!)}
      className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover cursor-pointer"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5">{body}</div>
  )
}

export function ActivityFeed({
  workspaceId,
  firstPage,
  onOpenChat,
}: {
  workspaceId: string
  firstPage: { events: FeedEvent[]; nextCursor: string | null }
  onOpenChat: (chatId: string) => void
}) {
  const [older, setOlder] = useState<FeedEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(firstPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // The first page refetches in the background; anything already paged in
  // belongs to the old first page's tail and would duplicate or skip.
  useEffect(() => {
    setOlder([])
    setCursor(firstPage.nextCursor)
  }, [workspaceId, firstPage.nextCursor])

  const loadOlder = async () => {
    if (!cursor) return
    setLoading(true)
    setError(false)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/events?before=${encodeURIComponent(cursor)}`)
      if (!r.ok) throw new Error(String(r.status))
      const page = (await r.json()) as { events: FeedEvent[]; nextCursor: string | null }
      setOlder((prev) => [...prev, ...page.events])
      setCursor(page.nextCursor)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const events = [...firstPage.events, ...older]

  return (
    <section className="mt-8">
      <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Activity</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">
          Nothing recorded yet. Runs, file changes and shared chats show up here.
        </p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-hairline">
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id}>
                <FeedItem event={e} onOpenChat={onOpenChat} />
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              onClick={() => void loadOlder()}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[12px] text-ink-3 hover:bg-hover cursor-pointer disabled:opacity-60"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {error ? "Could not load — try again" : "Load older"}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
