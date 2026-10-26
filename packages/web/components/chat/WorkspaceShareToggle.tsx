"use client"

import { Loader2, Users } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * One row: whether the workspace's members can read this chat. Rendered
 * above the public-link controls so the two are never confused — this one
 * reaches colleagues only and never makes a URL.
 */
export function WorkspaceShareToggle({
  shared,
  busy,
  onToggle,
  size = "sm",
}: {
  shared: boolean
  busy: boolean
  onToggle: () => void
  size?: "sm" | "md"
}) {
  const md = size === "md"
  return (
    <div className="flex items-start gap-3">
      <Users className={cn("mt-0.5 shrink-0 text-muted-foreground", md ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium text-foreground", md ? "text-sm" : "text-xs")}>
          Share with workspace members
        </p>
        <p className={cn("mt-0.5 text-muted-foreground", md ? "text-sm" : "text-xs")}>
          {shared
            ? "Members can read this chat from the workspace home page."
            : "Only you can see this chat."}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={shared}
        aria-label="Share with workspace members"
        onClick={onToggle}
        disabled={busy}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-60",
          shared ? "bg-primary" : "bg-muted"
        )}
      >
        {busy ? (
          <Loader2 className="mx-auto h-3 w-3 animate-spin text-foreground" />
        ) : (
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
              shared ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        )}
      </button>
    </div>
  )
}
