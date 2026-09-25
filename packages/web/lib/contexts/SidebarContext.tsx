"use client"

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react"
import {
  DEFAULT_SIDEBAR_CATEGORY,
  SIDEBAR_CATEGORY_KEY,
  SIDEBAR_COLLAPSED_KEY,
  parseSidebarCategory,
  parseSidebarCollapsed,
  type SidebarCategory,
} from "@/lib/sidebar-category"

// =============================================================================
// SidebarContext - Provides sidebar UI state to avoid prop drilling
// =============================================================================

export interface SidebarContextValue {
  // Collapsed leaves only the rail; the panel beside it is hidden.
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapse: () => void

  // Which category the rail has open in the panel
  category: SidebarCategory
  setCategory: (category: SidebarCategory) => void

  // Panel width, not counting the rail
  width: number
  setWidth: (width: number) => void

  // Mobile sidebar state
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  closeMobileSidebar: () => void

  // Repository filter
  repoFilter: string
  setRepoFilter: (filter: string) => void

  // Chat tree collapse state
  collapsedChatIds: Set<string>
  toggleChatCollapsed: (id: string) => void
  expandChatAndAncestors: (targetId: string, byId: Map<string, { parentChatId?: string | null }>) => void

  // Scheduled jobs view
  viewMode: "chat" | "scheduled-jobs"
  setViewMode: (mode: "chat" | "scheduled-jobs") => void
  selectedScheduledJob: { id: string; name: string } | null
  setSelectedScheduledJob: (job: { id: string; name: string } | null) => void
}

interface SidebarProviderProps {
  children: ReactNode
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// Constants for sidebar - exported for use by components
export const ALL_REPOSITORIES = "__all__"
export const NO_REPOSITORY = "__none__"
export const ARCHIVED_CHATS = "__archived__"
export const RAIL_WIDTH = 64
export const MIN_WIDTH = 180
export const MAX_WIDTH = 400
/** Dragging the panel narrower than this collapses it to the rail. */
export const COLLAPSE_THRESHOLD = 100

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode or a full quota: the choice lasts this session, which is fine.
  }
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [collapsed, setCollapsedState] = useState(false)
  const [category, setCategoryState] = useState<SidebarCategory>(DEFAULT_SIDEBAR_CATEGORY)

  // Restored after mount rather than in the initialiser: the server render has
  // no localStorage, and reading it during render would mismatch hydration.
  useEffect(() => {
    setCollapsedState(parseSidebarCollapsed(readStorage(SIDEBAR_COLLAPSED_KEY)))
    setCategoryState(parseSidebarCategory(readStorage(SIDEBAR_CATEGORY_KEY)))
  }, [])

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    writeStorage(SIDEBAR_COLLAPSED_KEY, String(next))
  }, [])
  const toggleCollapse = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed])

  const setCategory = useCallback((next: SidebarCategory) => {
    setCategoryState(next)
    writeStorage(SIDEBAR_CATEGORY_KEY, next)
  }, [])

  const [width, setWidth] = useState(240)

  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

  // Repository filter
  const [repoFilter, setRepoFilter] = useState<string>(ALL_REPOSITORIES)

  // Chat tree collapse state
  const [collapsedChatIds, setCollapsedChatIds] = useState<Set<string>>(new Set())

  const toggleChatCollapsed = useCallback((id: string) => {
    setCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandChatAndAncestors = useCallback((targetId: string, byId: Map<string, { parentChatId?: string | null }>) => {
    setCollapsedChatIds((prev) => {
      let next = prev
      let cur = byId.get(targetId)?.parentChatId
      while (cur) {
        if (next.has(cur)) {
          if (next === prev) next = new Set(prev)
          next.delete(cur)
        }
        cur = byId.get(cur)?.parentChatId
      }
      return next
    })
  }, [])

  // View mode (chat vs scheduled jobs)
  const [viewMode, setViewMode] = useState<"chat" | "scheduled-jobs">("chat")
  const [selectedScheduledJob, setSelectedScheduledJob] = useState<{ id: string; name: string } | null>(null)

  const value: SidebarContextValue = {
    collapsed,
    setCollapsed,
    toggleCollapse,
    category,
    setCategory,
    width,
    setWidth,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    closeMobileSidebar,
    repoFilter,
    setRepoFilter,
    collapsedChatIds,
    toggleChatCollapsed,
    expandChatAndAncestors,
    viewMode,
    setViewMode,
    selectedScheduledJob,
    setSelectedScheduledJob,
  }

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
