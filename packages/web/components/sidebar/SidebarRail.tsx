"use client"

import type { CSSProperties, ReactNode } from "react"
import { WorkspaceDropdown } from "@/components/workspaces/WorkspaceDropdown"
import { NotificationBell } from "@/components/notifications/NotificationBell"
import { SIDEBAR_CATEGORIES, type SidebarCategory } from "@/lib/sidebar-category"
import { cn } from "@/lib/utils"
import { CATEGORY_META, SIDEBAR_PANEL_ID, sidebarTabId } from "./categories"

interface SidebarRailProps {
  category: SidebarCategory
  /** False while collapsed: the choice is kept, but nothing is showing it. */
  panelOpen: boolean
  onSelect: (category: SidebarCategory) => void
  /** Categories that need attention, with the reason shown on hover. */
  badges: Partial<Record<SidebarCategory, string>>
  /** Collapse on desktop, close on mobile. */
  toggle: ReactNode
  /** The signed-in user's menu, or a way to sign in. */
  account: ReactNode
  /** Room for the macOS window controls in the desktop app. */
  isDesktopApp?: boolean
}

const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties

/**
 * The always-visible column of categories, like the app bar in Slack or Teams.
 * Picking one hands it the whole panel beside the rail, so no section is ever
 * squeezed under another — and with the panel collapsed, the rail is all that
 * is left, one click from anything.
 */
export function SidebarRail({
  category,
  panelOpen,
  onSelect,
  badges,
  toggle,
  account,
  isDesktopApp = false,
}: SidebarRailProps) {
  return (
    <nav
      aria-label="Sidebar"
      className={cn(
        // No border here: it would leave an odd content width, centring the
        // rail's buttons on half pixels — and the popovers anchored to them
        // with blurred text. The panel carries the divider instead.
        "flex w-16 shrink-0 flex-col items-center gap-1 px-1 pb-2",
        isDesktopApp ? "pt-[38px]" : "pt-2"
      )}
      style={isDesktopApp ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined}
    >
      <div className="flex flex-col items-center gap-1" style={isDesktopApp ? NO_DRAG : undefined}>
        <WorkspaceDropdown />
        <NotificationBell />
      </div>

      <div
        role="tablist"
        aria-label="Sidebar sections"
        aria-orientation="vertical"
        className="mt-2 flex flex-col items-center gap-1"
        style={isDesktopApp ? NO_DRAG : undefined}
      >
        {SIDEBAR_CATEGORIES.map((id) => (
          <RailTab
            key={id}
            id={id}
            selected={category === id}
            highlighted={panelOpen && category === id}
            badge={badges[id]}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="flex-1" />
      <div className="flex flex-col items-center gap-1" style={isDesktopApp ? NO_DRAG : undefined}>
        {toggle}
        {account}
      </div>
    </nav>
  )
}

interface RailTabProps {
  id: SidebarCategory
  selected: boolean
  highlighted: boolean
  badge?: string
  onSelect: (category: SidebarCategory) => void
}

function RailTab({ id, selected, highlighted, badge, onSelect }: RailTabProps) {
  const { label, railLabel, icon: Icon } = CATEGORY_META[id]
  return (
    <button
      type="button"
      role="tab"
      id={sidebarTabId(id)}
      aria-selected={selected}
      aria-controls={SIDEBAR_PANEL_ID}
      aria-label={label}
      title={label}
      onClick={() => onSelect(id)}
      className={cn(
        "relative flex w-14 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] leading-none transition-colors cursor-pointer",
        highlighted
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span>{railLabel ?? label}</span>
      {badge && (
        <span
          data-testid={`rail-badge-${id}`}
          title={badge}
          className="absolute right-3 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
        />
      )}
    </button>
  )
}
