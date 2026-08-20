"use client"

import { useEffect, useRef, useState } from "react"
import { Bell, MessageCircleQuestion, UserPlus, UserMinus } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePushSubscription } from "@/lib/hooks/usePushSubscription"
import {
  useNotificationsQuery,
  useMarkNotificationsRead,
  type NotificationItem,
} from "@/lib/query/hooks/useNotificationsQuery"

const ICONS = {
  agent_needs_input: MessageCircleQuestion,
  workspace_member_added: UserPlus,
  workspace_member_removed: UserMinus,
} as const

/** "3m", "2h", "5d" — a full timestamp is more precision than the bell needs. */
function shortAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

function NotificationRow({
  item,
  onNavigate,
}: {
  item: NotificationItem
  onNavigate: (item: NotificationItem) => void
}) {
  const Icon = ICONS[item.kind] ?? Bell
  return (
    <button
      onClick={() => onNavigate(item)}
      className={cn(
        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent",
        !item.readAt && "bg-accent/40"
      )}
      data-testid="notification-item"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">{item.title}</span>
        {item.body && (
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {item.body}
          </span>
        )}
      </span>
      <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {shortAge(item.createdAt)}
      </span>
    </button>
  )
}

/**
 * Turning browser push on, from inside the panel.
 *
 * Permission is requested here and nowhere else. Asking on page load is the
 * fastest route to a permanent "block", which cannot be undone from the page —
 * so the ask lives behind a control the user chose to click.
 */
function PushToggle() {
  const { state, busy, subscribe, unsubscribe } = usePushSubscription()

  // Nothing to offer if the browser cannot do it or the server has no keys.
  if (state === "unsupported" || state === "unconfigured") return null

  if (state === "denied") {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        title="Notifications are blocked for this site. Re-enable them in your browser's site settings — a page cannot ask again once blocked."
      >
        Push blocked
      </span>
    )
  }

  const on = state === "subscribed"
  return (
    <button
      onClick={() => (on ? unsubscribe() : subscribe())}
      disabled={busy}
      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50 cursor-pointer"
      data-testid="push-toggle"
    >
      {busy ? "…" : on ? "Disable push" : "Enable push"}
    </button>
  )
}

export function NotificationBell({
  onOpenChat,
  onOpenWorkspace,
}: {
  onOpenChat?: (chatId: string) => void
  onOpenWorkspace?: (workspaceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data } = useNotificationsQuery()
  const markRead = useMarkNotificationsRead()

  const items = data?.notifications ?? []
  const unread = data?.unreadCount ?? 0

  useEffect(() => {
    if (!open) return
    // Capture phase, like the workspace switcher: a click that lands on a
    // control elsewhere should close this AND do its own job, rather than being
    // swallowed by an overlay.
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("click", onDocClick, true)
    document.addEventListener("keydown", onEscape)
    return () => {
      document.removeEventListener("click", onDocClick, true)
      document.removeEventListener("keydown", onEscape)
    }
  }, [open])

  const handleOpen = () => {
    const next = !open
    setOpen(next)
    // Opening the panel is the act of reading it. Marking on open rather than
    // per-row means the badge matches what the user has actually seen.
    if (next && unread > 0) markRead.mutate(undefined)
  }

  const navigate = (item: NotificationItem) => {
    setOpen(false)
    if (item.chatId && onOpenChat) onOpenChat(item.chatId)
    else if (item.workspaceId && onOpenWorkspace) onOpenWorkspace(item.workspaceId)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={handleOpen}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        title="Notifications"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        data-testid="notification-bell"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-medium leading-none text-primary-foreground"
            data-testid="notification-badge"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11.5px] font-medium text-muted-foreground">
              Notifications
            </span>
            <PushToggle />
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              Nothing yet.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} onNavigate={navigate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
