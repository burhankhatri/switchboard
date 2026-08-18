"use client"

import { MessageSquare, FileText, Plug, CalendarClock } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarWorkspaceEmptyStateProps {
  isMobile?: boolean
}

const SECTIONS = [
  { icon: MessageSquare, label: "Chats" },
  { icon: FileText, label: "Files" },
  { icon: Plug, label: "Connections" },
  { icon: CalendarClock, label: "Runs" },
] as const

/**
 * Shown in the sidebar before a workspace is selected so the empty column
 * reads as intentional — not broken — and people know what lands here.
 */
export function SidebarWorkspaceEmptyState({ isMobile = false }: SidebarWorkspaceEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 flex flex-col",
        isMobile ? "px-6 py-8" : "px-4 py-6"
      )}
    >
      <p
        className={cn(
          "font-medium text-foreground/80",
          isMobile ? "text-base" : "text-sm"
        )}
      >
        Your workspace lives here
      </p>
      <p
        className={cn(
          "mt-1.5 text-muted-foreground leading-relaxed",
          isMobile ? "text-sm" : "text-xs"
        )}
      >
        Pick a workspace from the main screen, or use the menu above. Then this
        sidebar shows:
      </p>
      <ul className={cn("mt-4 space-y-2.5", isMobile ? "text-sm" : "text-xs")}>
        {SECTIONS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2.5 text-muted-foreground">
            <Icon className={cn("shrink-0 opacity-70", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
