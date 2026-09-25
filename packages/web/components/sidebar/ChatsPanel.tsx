"use client"

import { useCallback, useMemo, useState } from "react"
import { Search, SquarePen } from "lucide-react"
import { useModals } from "@/lib/contexts"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { PanelAction, PanelBody, PanelHeader, PanelSection } from "./Panel"
import { renderChatTree } from "./renderChatTree"
import { renderMobileChatTree } from "./renderMobileChatTree"

export interface ChatsPanelProps {
  /** Already filtered to what the sidebar shows, in compareChatsForSidebar order. */
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  /** Archived rows offer Unarchive instead of Archive, and take no merges. */
  showingArchived: boolean
  isMobile: boolean
  isLoading: boolean
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onOpenSearch: () => void
  onDeleteChat: (chatId: string) => void
  onPinChat?: (chatId: string, pinned: boolean) => void
  onBranchChat?: (chatId: string) => void
  onArchiveChat?: (chatId: string) => void
  onUnarchiveChat?: (chatId: string) => void
  onRenameChat: (chatId: string, newName: string) => void
  /** Controlled from the page so keyboard navigation can expand branches. */
  collapsedChatIds?: Set<string>
  onToggleChatCollapsed?: (id: string) => void
  onRequestMergeChats?: (sourceId: string, targetId?: string) => void
  onRequestRebaseChat?: (sourceId: string) => void
}

/**
 * Parent → children lookup plus the root list, preserving the incoming order.
 * A chat is a root when its parent is not in the list, so each subtree renders
 * self-contained.
 */
function buildTree(list: Chat[]) {
  const ids = new Set(list.map((c) => c.id))
  const childrenByParent = new Map<string, Chat[]>()
  for (const chat of list) {
    if (chat.parentChatId && ids.has(chat.parentChatId)) {
      const siblings = childrenByParent.get(chat.parentChatId) ?? []
      siblings.push(chat)
      childrenByParent.set(chat.parentChatId, siblings)
    }
  }
  const roots = list.filter((c) => !(c.parentChatId && ids.has(c.parentChatId)))
  return { childrenByParent, roots }
}

const SKELETON_WIDTHS = [70, 50, 85, 55, 75, 60]

export function ChatsPanel({
  chats,
  currentChatId,
  deletingChatIds,
  unseenChatIds,
  showingArchived,
  isMobile,
  isLoading,
  onSelectChat,
  onNewChat,
  onOpenSearch,
  onDeleteChat,
  onPinChat,
  onBranchChat,
  onArchiveChat,
  onUnarchiveChat,
  onRenameChat,
  collapsedChatIds: controlledCollapsedChatIds,
  onToggleChatCollapsed,
  onRequestMergeChats,
  onRequestRebaseChat,
}: ChatsPanelProps) {
  const modals = useModals()
  const { childrenByParent, roots } = useMemo(() => buildTree(chats), [chats])

  const [internalCollapsedChatIds, setInternalCollapsedChatIds] = useState<Set<string>>(new Set())
  const collapsedChatIds = controlledCollapsedChatIds ?? internalCollapsedChatIds
  const toggleInternal = useCallback((id: string) => {
    setInternalCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleChatCollapsed = onToggleChatCollapsed ?? toggleInternal

  // Drag-to-merge: the chat being dragged, and the valid target under the pointer.
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const chatById = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats])
  const canDrop = useCallback(
    (sourceId: string | null, targetId: string): boolean => {
      if (!sourceId || sourceId === targetId) return false
      const source = chatById.get(sourceId)
      const target = chatById.get(targetId)
      if (!source?.branch || !target?.branch) return false
      return source.repo !== NEW_REPOSITORY && source.repo === target.repo
    },
    [chatById]
  )
  const endDrag = () => {
    setDragSourceId(null)
    setDragOverId(null)
  }

  const shared = {
    childrenByParent,
    collapsedChatIds,
    currentChatId,
    deletingChatIds,
    unseenChatIds,
    onToggleCollapsed: toggleChatCollapsed,
    onSelectChat,
    onDeleteChat,
    onPin: showingArchived ? undefined : onPinChat,
    onBranch: showingArchived ? undefined : onBranchChat,
    onArchive: showingArchived ? undefined : onArchiveChat,
    onUnarchive: showingArchived ? onUnarchiveChat : undefined,
  }

  const renderRoots = (list: Chat[]) =>
    isMobile
      ? renderMobileChatTree({
          ...shared,
          roots: list,
          onRequestRename: (id: string, name: string) => modals.setMobileRenameChat({ id, name }),
        })
      : renderChatTree({
          ...shared,
          roots: list,
          sidebarCollapsed: false,
          onRenameChat,
          // Merge, rebase and drag-to-merge apply to active chats only.
          onMerge: showingArchived || !onRequestMergeChats ? undefined : (id: string) => onRequestMergeChats(id),
          onRebase: showingArchived || !onRequestRebaseChat ? undefined : (id: string) => onRequestRebaseChat(id),
          dragSourceId: showingArchived ? null : dragSourceId,
          dragOverId: showingArchived ? null : dragOverId,
          canDrop: showingArchived ? undefined : canDrop,
          onDragStartChat: showingArchived ? undefined : (id: string) => setDragSourceId(id),
          onDragEndChat: showingArchived ? undefined : endDrag,
          onDragEnterChat: showingArchived ? undefined : (id: string) => setDragOverId(id),
          onDragLeaveChat: showingArchived
            ? undefined
            : (id: string) => setDragOverId((prev) => (prev === id ? null : prev)),
          onDropChat: showingArchived
            ? undefined
            : (id: string) => {
                if (onRequestMergeChats && dragSourceId) onRequestMergeChats(dragSourceId, id)
                endDrag()
              },
        })

  // compareChatsForSidebar already put these first; the label says why.
  const needsYou = roots.filter((c) => c.awaitingInput)
  const rest = roots.filter((c) => !c.awaitingInput)

  return (
    <>
      <PanelHeader title="Chats">
        <PanelAction label="Search chats" onClick={onOpenSearch}>
          <Search className="h-4 w-4" />
        </PanelAction>
      </PanelHeader>
      {/* Labelled, not a lone pencil: starting a chat is the most common thing
          anyone does here, and an unlabelled icon was easy to miss. */}
      <div className="shrink-0 px-2 pb-1">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-[7px] text-sm text-foreground hover:bg-accent/60 cursor-pointer"
        >
          <SquarePen className="h-4 w-4 text-muted-foreground" />
          New chat
        </button>
      </div>
      <PanelBody>
        {isLoading ? (
          <div className="space-y-0 px-2 animate-pulse">
            {SKELETON_WIDTHS.map((width, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-[5px] rounded-md">
                <div className="h-5 flex-1 rounded bg-muted" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        ) : roots.length === 0 ? (
          <p className="px-4 py-2 text-xs leading-snug text-muted-foreground">
            No chats here yet. Start one with New chat above.
          </p>
        ) : (
          <>
            {needsYou.length > 0 && (
              <>
                <PanelSection title="Needs you" />
                <div className="px-2">{renderRoots(needsYou)}</div>
                {rest.length > 0 && <PanelSection title="Recent" />}
              </>
            )}
            <div className="px-2">{renderRoots(rest)}</div>
          </>
        )}
      </PanelBody>
    </>
  )
}
