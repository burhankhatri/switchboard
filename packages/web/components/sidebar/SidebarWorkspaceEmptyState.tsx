"use client"

import { SIDEBAR_CATEGORIES } from "@/lib/sidebar-category"
import { CATEGORY_META } from "./categories"

/**
 * Shown in the sidebar panel before a workspace is selected, so the empty
 * column reads as intentional — not broken — and people know what lands here.
 */
export function SidebarWorkspaceEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-6">
      <p className="text-sm font-medium text-foreground/80">Your workspace lives here</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Pick a workspace from the main screen, or from the tile at the top of the
        rail. Then each of these opens its own panel:
      </p>
      <ul className="mt-4 space-y-2.5 text-xs">
        {SIDEBAR_CATEGORIES.map((id) => {
          const { label, icon: Icon } = CATEGORY_META[id]
          return (
            <li key={id} className="flex items-center gap-2.5 text-muted-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span>{label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
