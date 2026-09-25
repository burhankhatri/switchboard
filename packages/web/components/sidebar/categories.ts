import { CalendarClock, Folder, MessageSquare, Plug, Sparkles, type LucideIcon } from "lucide-react"
import type { SidebarCategory } from "@/lib/sidebar-category"

interface CategoryMeta {
  label: string
  /** Shorter text under the rail icon, where the full label does not fit. */
  railLabel?: string
  icon: LucideIcon
}

export const CATEGORY_META: Record<SidebarCategory, CategoryMeta> = {
  chats: { label: "Chats", icon: MessageSquare },
  skills: { label: "Skills", icon: Sparkles },
  files: { label: "Files", icon: Folder },
  connections: { label: "Connections", railLabel: "Connect", icon: Plug },
  runs: { label: "Runs", icon: CalendarClock },
}

export const SIDEBAR_PANEL_ID = "sidebar-panel"
export const sidebarTabId = (category: SidebarCategory) => `sidebar-tab-${category}`
