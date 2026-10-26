"use client"

import { ArrowRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The one thing the home page is for, so it looks like it: a thin muted row
 * read as a disabled input and people went looking elsewhere.
 */
export function StartChatCard({
  workspaceName,
  onNewChat,
}: {
  workspaceName: string
  onNewChat: () => unknown
}) {
  return (
    <button
      onClick={() => void onNewChat()}
      className={cn(
        "group mt-6 flex w-full items-center gap-4 rounded-2xl border border-line-strong bg-surface",
        "px-5 py-5 text-left shadow-hairline transition-colors",
        "hover:border-primary/60 hover:bg-hover cursor-pointer"
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Plus className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink">Start a new chat</span>
        <span className="block truncate text-sm text-ink-3">
          Ask {workspaceName} to do something — its skills and connections are ready.
        </span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
