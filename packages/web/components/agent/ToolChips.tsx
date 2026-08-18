"use client"

import { useState } from "react"
import { ChevronRight, FileText, FolderSearch, Pencil, Search, Terminal, Wrench } from "lucide-react"
import type { ToolCall } from "@switchboard/common"
import { cn } from "@/lib/utils"

const ICONS: Record<string, typeof Wrench> = {
  write: Pencil, edit: Pencil, read: FileText,
  glob: FolderSearch, grep: Search, shell: Terminal,
}

/**
 * Tool calls as compact chips instead of a stacked list.
 *
 * A long turn can make dozens of calls; as rows they push the actual answer off
 * screen. As chips they stay scannable, and only the one you open expands.
 */
export function ToolChips({
  toolCalls,
  onOpenFile,
}: {
  toolCalls: ToolCall[]
  onOpenFile?: (filePath: string) => void
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (toolCalls.length === 0) return null

  return (
    <div className="my-1.5">
      <div className="flex flex-wrap gap-1">
        {toolCalls.map((tool, i) => {
          const Icon = ICONS[tool.tool] ?? Wrench
          const open = openIndex === i
          const expandable = !!tool.output || !!tool.fullSummary
          return (
            <button
              key={i}
              onClick={() => {
                if (tool.filePath && onOpenFile) return onOpenFile(tool.filePath)
                if (expandable) setOpenIndex(open ? null : i)
              }}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors",
                open
                  ? "border-primary/40 bg-accent text-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                (expandable || tool.filePath) && "cursor-pointer"
              )}
              title={tool.fullSummary ?? tool.summary}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{tool.summary}</span>
              {expandable && (
                <ChevronRight
                  className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
                />
              )}
            </button>
          )
        })}
      </div>

      {openIndex !== null && (
        <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-border bg-card p-2.5 text-[11px] leading-relaxed font-mono whitespace-pre-wrap">
          {toolCalls[openIndex].output ?? toolCalls[openIndex].fullSummary}
        </pre>
      )}
    </div>
  )
}
