/**
 * What the sidebar rail switches between. Each one takes over the whole panel,
 * so no section is ever squeezed below another.
 */
export const SIDEBAR_CATEGORIES = ["chats", "skills", "files", "connections", "runs"] as const

export type SidebarCategory = (typeof SIDEBAR_CATEGORIES)[number]

export const DEFAULT_SIDEBAR_CATEGORY: SidebarCategory = "chats"

export const SIDEBAR_CATEGORY_KEY = "switchboard.sidebar.category"
export const SIDEBAR_COLLAPSED_KEY = "switchboard.sidebar.collapsed"

/**
 * A saved category, or Chats. localStorage outlives deploys, so a value an
 * older build wrote must not select a panel that no longer exists.
 */
export function parseSidebarCategory(raw: string | null): SidebarCategory {
  return (SIDEBAR_CATEGORIES as readonly string[]).includes(raw ?? "")
    ? (raw as SidebarCategory)
    : DEFAULT_SIDEBAR_CATEGORY
}

export function parseSidebarCollapsed(raw: string | null): boolean {
  return raw === "true"
}
