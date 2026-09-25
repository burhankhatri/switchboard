"use client"

import type { ReactNode } from "react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { cn } from "@/lib/utils"

/**
 * The top of every sidebar panel: which workspace you are in, which category
 * you are looking at, and that category's actions. It sits above PanelBody
 * rather than sticking inside it, because the sidebar is translucent in dark
 * mode and a sticky header would show the list scrolling through it.
 */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  const { activeWorkspace } = useWorkspace()
  return (
    <div className="shrink-0 px-4 pb-2 pt-3">
      {activeWorkspace && (
        <p className="truncate text-[11px] text-muted-foreground">{activeWorkspace.name}</p>
      )}
      <div className="flex items-center gap-0.5">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** The panel's one scroll region. min-h-0 is what lets a flex child scroll. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto scrollbar-auto-hide pb-6">{children}</div>
}

interface PanelActionProps {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
}

export function PanelAction({ label, onClick, children, className }: PanelActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer",
        className
      )}
    >
      {children}
    </button>
  )
}

/** A group label inside a panel's list, e.g. "Needs you". */
export function PanelSection({ title }: { title: string }) {
  return (
    <h3 className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {title}
    </h3>
  )
}
