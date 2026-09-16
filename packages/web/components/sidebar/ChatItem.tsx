"use client"

import { useState, useRef, useEffect } from "react"
import { MoreHorizontal, Pencil, Trash2, ChevronDown, ChevronRight, Loader2, MessageCircleQuestion } from "lucide-react"
import { cn } from "@/lib/utils"
import { NEW_REPOSITORY } from "@/lib/types"
import type { Chat } from "@/lib/types"
import { AnchoredMenu } from "@/components/ui/AnchoredMenu"
import { hasMergedSuccessfully } from "./utils"
import { MergedChatCheckmark } from "./MergedChatCheckmark"

export interface ChatItemProps {
  chat: Chat
  isActive: boolean
  collapsed: boolean
  isDeleting: boolean
  isUnseen: boolean
  depth?: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpanded?: () => void
  onSelect: () => void
  onDelete: () => void
  /** When provided, the row shows a "Pin"/"Unpin" action toggling chat.pinned. */
  onPin?: (pinned: boolean) => void
  /** When provided, the row shows a "Branch chat" action. */
  onBranch?: () => void
  /** When provided, the row shows an "Archive" action (active, non-archived chats). */
  onArchive?: () => void
  /** When provided, the row is treated as archived and shows an "Unarchive" action. */
  onUnarchive?: () => void
  onRename: (newName: string) => void
  onMerge?: () => void
  onRebase?: () => void
  // Drag-to-merge props (optional; when omitted, drag is disabled).
  isDragSource?: boolean
  isDropTarget?: boolean
  onDragStartRow?: () => void
  onDragEndRow?: () => void
  onDragEnterRow?: () => void
  onDragOverRow?: (e: React.DragEvent) => void
  onDragLeaveRow?: () => void
  onDropRow?: () => void
}

export function ChatItem({ chat, isActive, collapsed, isDeleting, isUnseen, depth = 0, hasChildren = false, isExpanded = true, onToggleExpanded, onSelect, onDelete, onRename, isDragSource, isDropTarget, onDragStartRow, onDragEndRow, onDragEnterRow, onDragOverRow, onDragLeaveRow, onDropRow }: ChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = chat.displayName || "Untitled"

  const startEditing = () => {
    setEditName(displayName)
    setIsEditing(true)
    setMenuOpen(false)
  }

  const saveEdit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== displayName) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setEditName("")
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  if (isEditing && !collapsed) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-accent">
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit()
            if (e.key === "Escape") cancelEdit()
          }}
          onBlur={saveEdit}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        />
      </div>
    )
  }

  const indentPx = collapsed ? 0 : depth * 32

  const draggable = !!(onDragStartRow && chat.branch && chat.repo !== NEW_REPOSITORY)

  return (
    <div
      draggable={draggable}
      data-testid="chat-item"
      data-chat-id={chat.id}
      className={cn(
        "group flex items-center gap-2 rounded-md transition-colors select-none",
        collapsed ? "justify-center p-2" : "px-2 py-[5px]",
        isDeleting
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer",
        !isDeleting && (isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"),
        isDragSource && "opacity-50",
        isDropTarget && "ring-2 ring-primary/60 bg-primary/10"
      )}
      style={indentPx ? { paddingLeft: `calc(0.5rem + ${indentPx}px)` } : undefined}
      onMouseDown={(e) => {
        // Prevent the browser's native select-on-double-click from highlighting the title text.
        if (e.detail >= 2) e.preventDefault()
      }}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.effectAllowed = "move"
        try { e.dataTransfer.setData("text/plain", chat.id) } catch {}
        onDragStartRow?.()
      } : undefined}
      onDragEnd={draggable ? () => onDragEndRow?.() : undefined}
      onDragEnter={onDragEnterRow ? (e) => { e.preventDefault(); onDragEnterRow() } : undefined}
      onDragOver={onDragOverRow ? (e) => {
        // Continuously reassert that this row is the active drop target so
        // cursor movements over nested children don't flicker the highlight.
        onDragOverRow(e)
        onDragEnterRow?.()
      } : undefined}
      onDragLeave={onDragLeaveRow ? (e) => {
        // Ignore leaves into descendant elements — dragleave fires on the
        // parent whenever the cursor moves to a child node.
        const related = e.relatedTarget as Node | null
        if (related && e.currentTarget.contains(related)) return
        onDragLeaveRow()
      } : undefined}
      onDrop={onDropRow ? (e) => { e.preventDefault(); onDropRow() } : undefined}
      onClick={isDeleting ? undefined : onSelect}
      onDoubleClick={hasChildren && !isDeleting ? (e) => { e.stopPropagation(); onToggleExpanded?.() } : undefined}
    >
      {!collapsed && (
        <>
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpanded?.()
              }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center -ml-[1px] -mr-[5px] text-foreground/80 hover:text-primary hover:underline rounded-sm cursor-pointer"
              aria-label={isExpanded ? "Collapse children" : "Expand children"}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{displayName}</div>
          </div>

          <div className="relative">
            {chat.status === "running" || chat.status === "creating" || (chat.queuedMessages && chat.queuedMessages.length > 0) ? (
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
                <Loader2 className="h-2.5 w-2.5 animate-spin text-foreground/90" />
              </div>
            ) : chat.awaitingInput ? (
              /* Ranked above isUnseen: "the agent is blocked on you" is
                 actionable, "you have not read this" is not. Deliberately not
                 the same grey dot — the bell tells you a question arrived, this
                 is where you decide what to work on next. */
              <div
                className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none"
                title="This chat is waiting on your reply"
              >
                <MessageCircleQuestion className="h-2.5 w-2.5 text-primary" />
              </div>
            ) : isUnseen ? (
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80" />
              </div>
            ) : hasMergedSuccessfully(chat.messages) ? (
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
                <MergedChatCheckmark />
              </div>
            ) : null}
            <button
              ref={menuTriggerRef}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              disabled={isDeleting}
              className="p-1 rounded opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            <AnchoredMenu
              anchorRef={menuTriggerRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="right"
              placement="below"
              width={128}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  startEditing()
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                  setMenuOpen(false)
                }}
                disabled={isDeleting}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-destructive cursor-pointer disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </AnchoredMenu>
          </div>
        </>
      )}
    </div>
  )
}
