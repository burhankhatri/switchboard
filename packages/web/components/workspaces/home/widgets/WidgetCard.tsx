"use client"

import { HomeAiPrompt, HomeAiCardProgress } from "../HomeAi"
import dynamic from "next/dynamic"
import { Clock, MoreHorizontal } from "lucide-react"
import type { HomeJob } from "@/lib/workspace-home/home"
import type { WidgetDto } from "@/lib/workspace-home/widget-dto"
import type {
  ActionsContent,
  ChartContent,
  FileContent,
  FunnelContent,
  JobContent,
  KpisContent,
  NoteContent,
  StatContent,
  SummaryContent,
  TableContent,
  TimelineContent,
  WidgetType,
} from "@/lib/workspace-home/widgets"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { ago } from "../time"
import { FileBody, JobBody, NoteBody, StatBody, TableBody } from "./bodies"
import { ActionsBody, FunnelBody, KpisBody, SummaryBody, TimelineBody } from "./visuals"

const ChartBody = dynamic(() => import("./ChartBody"), {
  ssr: false,
  loading: () => <div className="h-60 animate-pulse rounded-lg bg-inset" />,
})

/**
 * Types that need the page's width to read: a row of numbers, a table, a
 * chart's x-axis, a timeline's dates beside its titles. The rest sit two up.
 */
const FULL_WIDTH: ReadonlySet<string> = new Set<WidgetType>([
  "summary",
  "kpis",
  "table",
  "chart",
  "timeline",
  "actions",
])

export const isFullWidth = (type: string) => FULL_WIDTH.has(type)

/**
 * "Updated by Weekly Lead Run · 2h ago": who or what wrote what the card says
 * now. A colleague reading a number needs to know whether a job keeps it
 * current or someone typed it once, and where to look if it seems wrong.
 */
function Provenance({
  widget,
  onOpenChat,
}: {
  widget: WidgetDto
  onOpenChat: (chatId: string) => void
}) {
  const when = ago(widget.updatedAt)
  const { job, chatId } = widget.source
  const who = job
    ? job.name ?? "a deleted job"
    : widget.createdVia === "agent" || chatId
      ? `${widget.updatedBy?.name ?? "a member"}'s agent`
      : (widget.updatedBy?.name ?? "a member")
  return (
    <p className="mt-auto flex items-center gap-1.5 pt-4 text-[11px] text-ink-3">
      <span className="min-w-0 truncate">
        Updated by{" "}
        {chatId ? (
          <button onClick={() => onOpenChat(chatId)} className="underline-offset-2 hover:underline cursor-pointer">
            {who}
          </button>
        ) : (
          who
        )}{" "}
        · {when}
      </span>
      {widget.stale && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-strong px-1.5 py-px text-ink-2"
          title="The job that keeps this current has missed at least two runs."
        >
          <Clock className="h-2.5 w-2.5" />
          Out of date
        </span>
      )}
    </p>
  )
}

export function WidgetCard({
  widget,
  jobs,
  fileExists,
  onOpenChat,
  onOpenFile,
  onEdit,
  onRemove,
  onMove,
  dragProps,
  dragging,
}: {
  widget: WidgetDto
  jobs: HomeJob[]
  fileExists: (path: string) => boolean | undefined
  onOpenChat: (chatId: string) => void
  onOpenFile: (path: string) => void
  onEdit: () => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean }
  dragging: boolean
}) {
  const hero = widget.type === "summary"
  return (
    <div
      {...dragProps}
      className={cn(
        "group flex min-w-0 flex-col rounded-2xl border border-line bg-surface shadow-hairline transition-shadow hover:shadow-raised",
        hero ? "p-6 sm:p-7" : "p-5",
        isFullWidth(widget.type) && "sm:col-span-2",
        dragging && "opacity-40"
      )}
    >
      <div className={cn("flex items-center gap-2", hero ? "mb-3" : "mb-4")}>
        <h3
          className={cn(
            "min-w-0 flex-1 truncate",
            hero
              ? "text-[11px] font-medium uppercase tracking-wide text-ink-3"
              : "text-[13px] font-medium text-ink"
          )}
          title={widget.title}
        >
          {widget.title}
        </h3>
        <HomeAiPrompt widget={widget} prompt={`Update this ${widget.type} (${widget.title}) using the latest workspace conversations. Preserve its purpose and change only what the evidence supports.`} />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-md p-1 text-ink-3 opacity-60 transition-opacity hover:bg-hover hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            aria-label={`Options for ${widget.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
            {/* Keyboard and touch can't drag; these are the same reorder. */}
            <DropdownMenuItem onSelect={() => onMove(-1)}>Move earlier</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(1)}>Move later</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="text-destructive">
              Remove for everyone
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <HomeAiCardProgress widgetId={widget.id} />
      <div className="min-w-0">
        {widget.type === "summary" && <SummaryBody content={widget.content as SummaryContent} />}
        {widget.type === "kpis" && <KpisBody content={widget.content as KpisContent} />}
        {widget.type === "funnel" && <FunnelBody content={widget.content as FunnelContent} />}
        {widget.type === "timeline" && <TimelineBody content={widget.content as TimelineContent} />}
        {widget.type === "actions" && <ActionsBody content={widget.content as ActionsContent} />}
        {widget.type === "stat" && <StatBody content={widget.content as StatContent} />}
        {widget.type === "table" && <TableBody content={widget.content as TableContent} />}
        {widget.type === "chart" && <ChartBody content={widget.content as ChartContent} />}
        {widget.type === "note" && <NoteBody content={widget.content as NoteContent} />}
        {widget.type === "file" && (
          <FileBody
            content={widget.content as FileContent}
            exists={fileExists((widget.content as FileContent).path)}
            onOpen={onOpenFile}
          />
        )}
        {widget.type === "job" && (
          <JobBody
            content={widget.content as JobContent}
            job={jobs.find((j) => j.id === (widget.content as JobContent).jobId)}
            onOpenChat={onOpenChat}
          />
        )}
      </div>

      <Provenance widget={widget} onOpenChat={onOpenChat} />
    </div>
  )
}
