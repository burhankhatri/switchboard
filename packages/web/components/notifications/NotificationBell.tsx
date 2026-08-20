"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bell, MessageCircleQuestion, UserPlus, UserMinus } from "lucide-react"
import { cn } from "@/lib/utils"
import { pushTargetUrl } from "@/lib/push"
import { anchoredPanelPosition, type PanelPosition } from "@/lib/anchored-panel"
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
        {/* Two lines, not truncate: the workspace or chat name sits at the END
            of the title ("Wayne added you to Marketing Automation"), so a
            single truncated line cuts off the one part that identifies what
            the notification is about. */}
        <span className="block line-clamp-2 text-[13px] text-foreground">{item.title}</span>
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
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // The panel is portalled out of the sidebar, so it is NOT inside
  // containerRef — the click-outside check has to know about it separately or
  // it closes on the first click landing inside the panel itself.
  const panelRef = useRef<HTMLDivElement>(null)

  const PANEL_WIDTH = 320

  const reposition = useCallback(() => {
    const button = containerRef.current?.querySelector("button")
    if (!button) return
    const rect = button.getBoundingClientRect()
    setPosition(
      anchoredPanelPosition({
        anchor: { left: rect.left, bottom: rect.bottom },
        viewportWidth: window.innerWidth,
        panelWidth: PANEL_WIDTH,
      })
    )
  }, [])

  // Before paint, so the panel never shows at the wrong spot for a frame.
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [open, reposition])
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
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
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
    if (item.chatId && onOpenChat) return onOpenChat(item.chatId)
    if (item.workspaceId && onOpenWorkspace) return onOpenWorkspace(item.workspaceId)

    // No handler supplied: fall back to a real navigation rather than doing
    // nothing. The bell is mounted deep in the header, several layers from the
    // page that owns selectChat, and a notification that swallows its own click
    // is worse than one extra page load. useUrlSync reconstructs state from the
    // URL on load, so this lands correctly.
    const url = pushTargetUrl({
      chatId: item.chatId,
      workspaceId: item.workspaceId,
    })
    window.location.assign(url)
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

      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // Fixed and portalled to <body>. The sidebar sets backdrop-blur-xl,
            // which creates a stacking context, so a panel rendered inside it
            // is painted under the main content whatever its z-index — which is
            // exactly what happened: the panel was visible up to the sidebar's
            // edge and cut off there.
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
            className="fixed z-[100] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
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
          </div>,
          document.body
        )}
    </div>
  )
}
