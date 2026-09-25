"use client"

import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { LogIn, PanelLeft, X } from "lucide-react"
import { WorkspaceConnections } from "@/components/workspaces/WorkspaceConnections"
import { WorkspaceFiles } from "@/components/workspaces/WorkspaceFiles"
import { WorkspaceRuns } from "@/components/workspaces/WorkspaceRuns"
import { WorkspaceSkills } from "@/components/workspaces/WorkspaceSkills"
import { usePalette } from "@/components/search-palette/PaletteProvider"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import {
  useSidebar,
  ALL_REPOSITORIES,
  ARCHIVED_CHATS,
  MIN_WIDTH,
  MAX_WIDTH,
  RAIL_WIDTH,
  COLLAPSE_THRESHOLD,
} from "@/lib/contexts"
import { signInWithGitHub } from "@/lib/auth-utils"
import { compareChatsForSidebar, isChatVisibleForFilter } from "@/lib/chat-tree"
import { useElectron } from "@/lib/hooks/useElectron"
import { hasActiveRun, useWorkspaceRuns } from "@/lib/query/hooks/useWorkspaceRuns"
import type { SidebarCategory } from "@/lib/sidebar-category"
import type { Chat } from "@/lib/types"
import { cn } from "@/lib/utils"
import { UserMenu, SidebarWorkspaceEmptyState } from "./sidebar/index"
import { ChatsPanel } from "./sidebar/ChatsPanel"
import { PanelHeader } from "./sidebar/Panel"
import { SidebarRail } from "./sidebar/SidebarRail"
import { CATEGORY_META, SIDEBAR_PANEL_ID, sidebarTabId } from "./sidebar/categories"

// Re-export from context for backward compatibility
export { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  /** Pin or unpin a chat, sorting it to the top of the list. */
  onPinChat?: (chatId: string, pinned: boolean) => void
  /** Branch a new chat from an existing chat (creates a sibling and switches to it). */
  onBranchChat?: (chatId: string) => void
  /** Archive an active chat (and its branches), moving it into the archived section. */
  onArchiveChat?: (chatId: string) => void
  /** Restore an archived chat (and its branches) back to the active list. */
  onUnarchiveChat?: (chatId: string) => void
  onRenameChat: (chatId: string, newName: string) => void
  /** Collapsed leaves only the rail. */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Panel width, not counting the rail. */
  width: number
  onWidthChange: (width: number) => void
  // Mobile drawer props
  isMobile?: boolean
  mobileOpen?: boolean
  onMobileClose?: () => void
  /** Repository filter (controlled from parent) */
  repoFilter?: string
  // Collapsed chat-tree state (controlled from parent so keyboard navigation
  // can expand branches programmatically).
  collapsedChatIds?: Set<string>
  onToggleChatCollapsed?: (id: string) => void
  /** Drag a chat onto another (same repo) to kick off a merge, or pick Merge
   *  from a chat's context menu (target left unspecified). */
  onRequestMergeChats?: (sourceId: string, targetId?: string) => void
  /** Pick Rebase from a chat's context menu. */
  onRequestRebaseChat?: (sourceId: string) => void
  /** Open scheduled jobs view */
  onOpenScheduledJobs?: () => void
  /** Whether scheduled jobs view is active */
  scheduledJobsActive?: boolean
  /** Whether chats are still being loaded from storage/server */
  isLoadingChats?: boolean
}

/**
 * A rail of categories beside one panel. The rail picks Chats, Skills, Files,
 * Connections or Runs, and that category owns the whole panel — the column
 * used to stack all five with two scroll regions, and whichever you needed was
 * the one cut off. One tree serves desktop and the mobile drawer alike, so a
 * change here cannot land on only one of them.
 */
export function Sidebar({
  chats,
  currentChatId,
  deletingChatIds,
  unseenChatIds,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onPinChat,
  onBranchChat,
  onArchiveChat,
  onUnarchiveChat,
  onRenameChat,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
  repoFilter = ALL_REPOSITORIES,
  collapsedChatIds,
  onToggleChatCollapsed,
  onRequestMergeChats,
  onRequestRebaseChat,
  onOpenScheduledJobs,
  scheduledJobsActive = false,
  isLoadingChats = false,
}: SidebarProps) {
  const { data: session, status: sessionStatus } = useSession()
  const { activeWorkspace } = useWorkspace()
  const { category, setCategory } = useSidebar()
  const { openSearch } = usePalette()
  const { isDesktopApp } = useElectron()
  const isResizing = useRef(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Visibility and order are both delegated to chat-tree so the rendered list
  // can never drift from what keyboard navigation reaches.
  const visibleChats = useMemo(
    () =>
      chats
        .filter((chat) => isChatVisibleForFilter(chat, repoFilter, activeWorkspace?.id ?? null))
        .sort(compareChatsForSidebar),
    [chats, repoFilter, activeWorkspace]
  )

  const { data: runsData } = useWorkspaceRuns(activeWorkspace?.id)
  const badges: Partial<Record<SidebarCategory, string>> = {
    chats: visibleChats.some((c) => c.awaitingInput) ? "A chat is waiting on your reply" : undefined,
    runs: hasActiveRun(runsData?.runs ?? []) ? "A run is in progress" : undefined,
  }

  // The panel follows what the main pane opens from elsewhere — the palette, a
  // notification, a /jobs link — so the thing you are looking at is listed.
  useEffect(() => {
    if (scheduledJobsActive) setCategory("runs")
  }, [scheduledJobsActive, setCategory])
  useEffect(() => {
    if (currentChatId) setCategory("chats")
  }, [currentChatId, setCategory])

  const handleToggleCollapse = useCallback(() => {
    setIsAnimating(true)
    onToggleCollapse()
    setTimeout(() => setIsAnimating(false), 200)
  }, [onToggleCollapse])

  const selectCategory = (next: SidebarCategory) => {
    setCategory(next)
    if (collapsed) handleToggleCollapse()
  }

  // Drag-resize the panel (desktop only). Widths are measured from the rail's
  // edge; dragging below the threshold collapses to the rail.
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  const stopResizing = useCallback(() => {
    isResizing.current = false
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing.current) return
      const panelWidth = e.clientX - RAIL_WIDTH
      if (panelWidth < COLLAPSE_THRESHOLD) {
        if (!collapsed) onToggleCollapse()
        return
      }
      if (collapsed) {
        onToggleCollapse()
        onWidthChange(MIN_WIDTH)
        return
      }
      onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, panelWidth)))
    },
    [onWidthChange, collapsed, onToggleCollapse]
  )

  useEffect(() => {
    if (isMobile) return
    window.addEventListener("mousemove", resize)
    window.addEventListener("mouseup", stopResizing)
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [resize, stopResizing, isMobile])

  // Lock the page behind the open drawer.
  useEffect(() => {
    document.body.style.overflow = isMobile && mobileOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [isMobile, mobileOpen])

  // On mobile, anything that changes the main pane also puts the drawer away.
  const closingDrawer = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      fn(...args)
      if (isMobile) onMobileClose?.()
    }

  const panelContent: Record<SidebarCategory, () => ReactNode> = {
    chats: () => (
      <ChatsPanel
        chats={visibleChats}
        currentChatId={currentChatId}
        deletingChatIds={deletingChatIds}
        unseenChatIds={unseenChatIds}
        showingArchived={repoFilter === ARCHIVED_CHATS}
        isMobile={isMobile}
        isLoading={isLoadingChats}
        onSelectChat={closingDrawer(onSelectChat)}
        onNewChat={closingDrawer(onNewChat)}
        onOpenSearch={closingDrawer(openSearch)}
        onDeleteChat={onDeleteChat}
        onPinChat={onPinChat}
        onBranchChat={onBranchChat}
        onArchiveChat={onArchiveChat}
        onUnarchiveChat={onUnarchiveChat}
        onRenameChat={onRenameChat}
        collapsedChatIds={collapsedChatIds}
        onToggleChatCollapsed={onToggleChatCollapsed}
        onRequestMergeChats={onRequestMergeChats}
        onRequestRebaseChat={onRequestRebaseChat}
      />
    ),
    skills: () => <WorkspaceSkills />,
    files: () => <WorkspaceFiles />,
    connections: () => <WorkspaceConnections />,
    runs: () => (
      <WorkspaceRuns
        onOpenScheduled={() => onOpenScheduledJobs?.()}
        scheduledActive={scheduledJobsActive}
      />
    ),
  }

  const panel = (
    <div
      role="tabpanel"
      id={SIDEBAR_PANEL_ID}
      aria-labelledby={sidebarTabId(category)}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-sidebar-border"
    >
      {activeWorkspace ? (
        panelContent[category]()
      ) : (
        <>
          <PanelHeader title={CATEGORY_META[category].label} />
          <SidebarWorkspaceEmptyState />
        </>
      )}
    </div>
  )

  const toggle = isMobile ? (
    <RailButton label="Close menu" onClick={() => onMobileClose?.()}>
      <X className="h-4 w-4" />
    </RailButton>
  ) : (
    <RailButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={handleToggleCollapse}>
      <PanelLeft className="h-4 w-4" />
    </RailButton>
  )

  const account =
    sessionStatus === "loading" ? (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
    ) : session?.user ? (
      <UserMenu user={session.user} collapsed />
    ) : (
      <RailButton label="Sign in with GitHub" onClick={() => signInWithGitHub()}>
        <LogIn className="h-4 w-4" />
      </RailButton>
    )

  const rail = (
    <SidebarRail
      category={category}
      panelOpen={isMobile || !collapsed}
      onSelect={selectCategory}
      badges={badges}
      toggle={toggle}
      account={account}
      isDesktopApp={isDesktopApp}
    />
  )

  if (isMobile) {
    return (
      <>
        <div
          className={cn(
            "fixed inset-0 z-40 mobile-overlay transition-opacity duration-300",
            mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          onClick={onMobileClose}
          aria-hidden="true"
        />
        <div
          className="fixed inset-y-0 left-0 z-50 flex w-[280px] bg-sidebar border-r border-sidebar-border pt-safe pb-safe transition-transform duration-300 ease-out"
          style={{ transform: mobileOpen ? "translateX(0)" : "translateX(-100%)" }}
        >
          {rail}
          {panel}
        </div>
      </>
    )
  }

  return (
    <div
      className={cn(
        "relative flex h-full bg-sidebar border-r border-sidebar-border hide-mobile",
        isAnimating && "transition-[width] duration-200 ease-in-out"
      )}
      style={{ width: RAIL_WIDTH + (collapsed ? 0 : width) }}
    >
      {rail}
      {!collapsed && panel}
      {!collapsed && (
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-muted-foreground/30 active:bg-muted-foreground/50 transition-colors"
        />
      )}
    </div>
  )
}

function RailButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
    >
      {children}
    </button>
  )
}
