"use client"

import { useEffect, useState } from "react"
import { LoadingState } from "@/components/ui/LoadingState"
import { cn } from "@/lib/utils"

const STEPS = [
  "Checking workspaces repository…",
  "Creating folder in GitHub…",
  "Adding starter skill…",
  "Finishing setup…",
] as const

interface WorkspaceCreatingPanelProps {
  /** Workspace name being created — shown so the wait feels tied to an action. */
  name?: string
  className?: string
  /** When the create request started (for elapsed timer). */
  startedAt?: number
}

/**
 * Feedback while POST /api/workspaces runs. The route commits several files to
 * GitHub, which routinely takes 10–30s with no intermediate response — without
 * this, the UI looks frozen after clicking Create.
 */
export function WorkspaceCreatingPanel({
  name,
  className,
  startedAt,
}: WorkspaceCreatingPanelProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length)
    }, 2800)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      className={cn("rounded-xl border border-border bg-card p-5", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {name && (
        <p className="text-sm font-medium text-foreground truncate">{name}</p>
      )}
      <LoadingState
        label={STEPS[step]}
        startedAt={startedAt}
        className="mt-3"
      />
      <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
        Committing starter files to GitHub. This usually takes 10–30 seconds —
        the page will open your workspace when it&apos;s ready.
      </p>
    </div>
  )
}
