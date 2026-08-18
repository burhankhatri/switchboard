"use client"

import { useState } from "react"
import { ChevronRight, Brain } from "lucide-react"
import type { ToolCall } from "@switchboard/common"
import { cn } from "@/lib/utils"

/**
 * Collapsed trace of what the agent did before answering.
 *
 * Collapsed by default and labelled with a duration, because the trace is
 * reassurance while you wait and noise once the answer exists — but deleting it
 * makes a wrong answer impossible to diagnose. Collapsing keeps both.
 */
export function Thinking({
  toolCalls,
  durationMs,
  running,
  defaultOpen,
}: {
  toolCalls: ToolCall[]
  durationMs?: number
  running?: boolean
  defaultOpen?: boolean
}) {
  // Open while running so there is something to watch; closed once done.
  const [open, setOpen] = useState(defaultOpen ?? !!running)
  if (toolCalls.length === 0) return null

  const label = running
    ? "Working…"
    : durationMs
      ? `Thought for ${Math.max(1, Math.round(durationMs / 1000))} seconds`
      : `${toolCalls.length} step${toolCalls.length === 1 ? "" : "s"}`

  return (
    <div className="my-1.5 rounded-lg border border-border bg-card/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Brain className={cn("h-3 w-3 shrink-0", running && "animate-pulse text-primary")} />
        <span className="flex-1">{label}</span>
        {!open && <span className="tabular-nums">{toolCalls.length}</span>}
      </button>

      {open && (
        <ol className="border-t border-border px-2.5 py-1.5">
          {toolCalls.map((tool, i) => (
            <li key={i} className="flex items-start gap-2 py-0.5 text-[11.5px]">
              <span
                className={cn(
                  "mt-1.5 h-1 w-1 shrink-0 rounded-full",
                  running && i === toolCalls.length - 1 ? "bg-primary animate-pulse" : "bg-muted-foreground/50"
                )}
              />
              <span className="min-w-0 flex-1 text-muted-foreground">
                <span className="truncate block">{tool.summary}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
