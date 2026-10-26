"use client"

import { ArrowDownRight, ArrowRight, ArrowUpRight, ExternalLink, FileText } from "lucide-react"
import { MarkdownPreview } from "@/lib/file-preview/MarkdownPreview"
import type { HomeJob } from "@/lib/workspace-home/home"
import type {
  FileContent,
  JobContent,
  NoteContent,
  StatContent,
  TableContent,
} from "@/lib/workspace-home/widgets"
import { cn } from "@/lib/utils"
import { ago } from "../time"

/**
 * The server already refuses anything but http(s); checked again here because
 * this is the line that turns stored text into something clickable.
 */
function safeHref(link: string | undefined): string | null {
  if (!link) return null
  try {
    const u = new URL(link)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    return null
  }
}

export function WidgetFooter({ note, link }: { note?: string; link?: string }) {
  const href = safeHref(link)
  if (!note && !href) return null
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
      {note && <span className="min-w-0 flex-1 truncate">{note}</span>}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex shrink-0 items-center gap-0.5 text-ink-2 hover:underline"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

export function StatBody({ content }: { content: StatContent }) {
  const change = content.change
  const ChangeIcon =
    change?.direction === "up" ? ArrowUpRight : change?.direction === "down" ? ArrowDownRight : ArrowRight
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl tabular-nums tracking-tight text-ink">
          {typeof content.value === "number" ? content.value.toLocaleString() : content.value}
        </span>
        {content.unit && <span className="text-sm text-ink-3">{content.unit}</span>}
      </div>
      {change && (
        // Direction is carried by the arrow and the words, not by colour: up is
        // not always good (costs, failures), and the widget cannot know which.
        <p className="mt-1 inline-flex items-center gap-0.5 text-[12px] text-ink-2">
          <ChangeIcon className="h-3.5 w-3.5" />
          {change.value}
        </p>
      )}
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

export function TableBody({ content }: { content: TableContent }) {
  return (
    <div>
      <div className="max-h-72 overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {content.columns.map((c, i) => (
                <th key={i} className="border-b border-line px-2 py-1.5 text-left font-medium text-ink-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-2 py-1.5 align-top text-ink",
                      typeof cell === "number" && "text-right tabular-nums"
                    )}
                  >
                    {cell === null ? <span className="text-ink-3">—</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {content.rows.length === 0 && <p className="mt-2 text-[12px] text-ink-3">No rows.</p>}
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

export function NoteBody({ content }: { content: NoteContent }) {
  // react-markdown without a raw-HTML plugin: any HTML in the note shows as
  // text, which is the point.
  return (
    <div className="-m-6 max-h-72 overflow-auto text-[13px]">
      <MarkdownPreview content={content.markdown} />
    </div>
  )
}

export function FileBody({
  content,
  exists,
  onOpen,
}: {
  content: FileContent
  exists: boolean | undefined
  onOpen: (path: string) => void
}) {
  const name = content.path.split("/").pop() ?? content.path
  if (exists === false) {
    return <p className="text-[13px] text-ink-3">{name} has been deleted or moved.</p>
  }
  return (
    <button
      onClick={() => onOpen(content.path)}
      className="flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-hover cursor-pointer"
    >
      <FileText className="h-4 w-4 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{name}</span>
        <span className="block truncate text-[11px] text-ink-3">Open to preview</span>
      </span>
    </button>
  )
}

export function JobBody({
  content,
  job,
  onOpenChat,
}: {
  content: JobContent
  job: HomeJob | undefined
  onOpenChat: (chatId: string) => void
}) {
  if (!job) {
    return <p className="text-[13px] text-ink-3">This job no longer exists.</p>
  }
  void content
  const last = job.lastRun
  return (
    <div className="text-[13px]">
      <p className="text-ink">{job.schedule}</p>
      <p className="mt-0.5 text-ink-2">
        {job.health.state === "healthy"
          ? "Working"
          : job.health.state === "failing"
            ? `Failing${job.health.failures > 1 ? ` (${job.health.failures} in a row)` : ""}`
            : job.health.state === "paused"
              ? "Paused"
              : job.health.state === "running"
                ? "Running now"
                : job.health.state === "awaiting_approval"
                  ? "Awaiting approval"
                  : "Not run yet"}
        {last && ` · last ran ${ago(last.startedAt)}`}
      </p>
      {last?.chatId && (
        <button
          onClick={() => onOpenChat(last.chatId!)}
          className="mt-2 text-[12px] text-ink-2 underline-offset-2 hover:underline cursor-pointer"
        >
          Read the last run
        </button>
      )}
    </div>
  )
}
