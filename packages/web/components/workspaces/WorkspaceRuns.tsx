"use client"

import { Clock, Loader2 } from "lucide-react"
import { TaskRows } from "@/components/agent/TaskRows"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useWorkspaceRuns } from "@/lib/query/hooks/useWorkspaceRuns"
import { cn } from "@/lib/utils"
import { PanelBody, PanelHeader, PanelSection } from "@/components/sidebar/Panel"

interface WorkspaceRunsProps {
  onOpenScheduled: () => void
  /** The scheduled agents view is open in the main pane. */
  scheduledActive: boolean
}

/**
 * The Runs panel: agent work that happens without you in the chat. Scheduled
 * agents are how that work starts and the runs are what it did, so they share
 * a panel rather than splitting across two.
 */
export function WorkspaceRuns({ onOpenScheduled, scheduledActive }: WorkspaceRunsProps) {
  const { activeWorkspace } = useWorkspace()
  const { data, isLoading, error } = useWorkspaceRuns(activeWorkspace?.id)

  if (!activeWorkspace) return null
  const runs = data?.runs ?? []

  return (
    <>
      <PanelHeader title="Runs" />
      <PanelBody>
        <div className="px-2">
          <button
            type="button"
            onClick={onOpenScheduled}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-sm transition-colors cursor-pointer",
              scheduledActive ? "bg-accent" : "hover:bg-accent/50"
            )}
          >
            <Clock className="h-4 w-4 text-muted-foreground" />
            Scheduled
          </button>
        </div>

        <PanelSection title="Recent runs" />
        <div className="px-2">
          {isLoading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          {error && <p className="px-2 py-1.5 text-xs text-muted-foreground">Could not load runs.</p>}
          {!isLoading && !error && runs.length === 0 && (
            <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">
              Nothing has run yet. Schedule an agent and its runs land here.
            </p>
          )}
          {runs.length > 0 && <TaskRows runs={runs} />}
        </div>
      </PanelBody>
    </>
  )
}
