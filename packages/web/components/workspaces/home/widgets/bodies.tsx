"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowDownRight, ArrowRight, ArrowUpRight, ExternalLink, FileText } from "lucide-react"
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
import { TONE, statusTone } from "./tone"

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
    <div className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-ink-3">
      {/* Two lines, not one: a note cut mid-word read as a broken card. */}
      {note && (
        <span className="line-clamp-2 min-w-0 flex-1" title={note}>
          {note}
        </span>
      )}
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
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-[40px] leading-none tabular-nums tracking-tight text-ink">
          {typeof content.value === "number" ? content.value.toLocaleString() : content.value}
        </span>
        {content.unit && <span className="text-sm text-ink-3">{content.unit}</span>}
        {change && (
          // Direction is carried by the arrow and the words, not by colour: up is
          // not always good (costs, failures), and the widget cannot know which.
          <span className="inline-flex items-center gap-0.5 self-center rounded-full bg-inset px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-2">
            <ChangeIcon className="h-3 w-3" />
            {change.value}
          </span>
        )}
      </div>
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

const TABLE_PREVIEW = 8
const STATUS_COLUMN = /^(status|state|stage)$/i
// Columns where a bar would compare things that are not amounts.
const NOT_AN_AMOUNT = /\b(id|year|zip|date|rank|#)\b/i

/** "2.80%", "$1,200", 1178 → a number; anything else → null. */
export function amountOf(cell: unknown): number | null {
  if (typeof cell === "number") return cell
  if (typeof cell !== "string") return null
  const m = cell.trim().match(/^-?\$?([\d,]*\.?\d+)\s*%?$/)
  if (!m) return null
  const n = Number(cell.replace(/[$,%\s]/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * The largest amount in each column that is all amounts, or null. A small bar
 * behind each number lets a column be compared at a glance, which is the
 * thing a table of rates is hardest at.
 */
function columnMaxima(content: TableContent): (number | null)[] {
  return content.columns.map((name, c) => {
    if (content.rows.length < 3 || NOT_AN_AMOUNT.test(name)) return null
    let max = 0
    for (const row of content.rows) {
      if (row[c] === null) continue
      const n = amountOf(row[c])
      if (n === null || n < 0) return null
      max = Math.max(max, n)
    }
    return max > 0 ? max : null
  })
}

export function TableBody({ content }: { content: TableContent }) {
  const [all, setAll] = useState(false)
  const maxima = columnMaxima(content)
  const status = content.columns.map((c) => STATUS_COLUMN.test(c.trim()))
  // Rows past the preview are behind a button, not an inner scrollbar: a
  // scroll box inside a scrolling page traps the wheel and hid the header.
  const rows = all ? content.rows : content.rows.slice(0, TABLE_PREVIEW)
  const hidden = content.rows.length - rows.length

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {content.columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    "border-b border-line px-2.5 pb-2 text-left text-[11px] font-medium uppercase tracking-wide whitespace-nowrap text-ink-3",
                    maxima[i] !== null && "text-right"
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-0 hover:bg-hover/60">
                {row.map((cell, c) => {
                  if (cell === null) {
                    return (
                      <td key={c} className={cn("px-2.5 py-2 text-ink-3", maxima[c] !== null && "text-right")}>
                        —
                      </td>
                    )
                  }
                  if (status[c] && typeof cell === "string") {
                    const tone = statusTone(cell)
                    return (
                      <td key={c} className="px-2.5 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink",
                            tone ? TONE[tone].bg : "bg-inset text-ink-2"
                          )}
                        >
                          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", tone ? TONE[tone].dot : "bg-ink-3")} />
                          {cell}
                        </span>
                      </td>
                    )
                  }
                  const max = maxima[c]
                  const n = max !== null ? amountOf(cell) : null
                  const shown = typeof cell === "number" ? cell.toLocaleString() : cell
                  return (
                    <td
                      key={c}
                      className={cn(
                        "px-2.5 py-2 align-top text-ink",
                        max !== null && "text-right tabular-nums whitespace-nowrap"
                      )}
                    >
                      {max !== null && n !== null ? (
                        // A short track beside the number rather than a fill
                        // behind it: behind, a full bar read as a highlighted
                        // cell and a tiny one as a stray rule.
                        <span className="inline-flex items-center justify-end gap-2">
                          <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-inset">
                            <span
                              className="block h-full rounded-full bg-[var(--series-1)]"
                              style={{ width: n === 0 ? 0 : `${Math.max((n / max) * 100, 4)}%` }}
                            />
                          </span>
                          {shown}
                        </span>
                      ) : (
                        shown
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {content.rows.length === 0 && <p className="mt-2 text-[12px] text-ink-3">No rows.</p>}
      {(hidden > 0 || all) && content.rows.length > TABLE_PREVIEW && (
        <button
          onClick={() => setAll((v) => !v)}
          className="mt-2 text-[12px] text-ink-2 hover:text-ink cursor-pointer"
        >
          {all ? "Show fewer" : `Show all ${content.rows.length} rows`}
        </button>
      )}
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

// Sized for a card, not a document: a heading in a note is a bold line, not
// a 32px title. Images render as their alt text — a widget never makes the
// browser fetch a URL on its own.
const NOTE_MARKDOWN: Components = {
  h1: ({ children }) => <p className="mb-1.5 font-semibold text-ink">{children}</p>,
  h2: ({ children }) => <p className="mb-1.5 font-semibold text-ink">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-medium text-ink">{children}</p>,
  h4: ({ children }) => <p className="mb-1 font-medium text-ink">{children}</p>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0 marker:text-ink-3">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0 marker:text-ink-3">{children}</ol>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-inset px-1 py-px font-mono text-[12px]">{children}</code>,
  a: ({ href, children }) => {
    const safe = safeHref(href)
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
        {children}
      </a>
    ) : (
      <>{children}</>
    )
  },
  img: ({ alt }) => <>{alt}</>,
  hr: () => <hr className="my-3 border-line" />,
}

const NOTE_COLLAPSED_PX = 200

export function NoteBody({ content }: { content: NoteContent }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  // Template comments are for whoever edits the source, never for readers.
  const markdown = content.markdown.replace(/<!--[\s\S]*?-->/g, "").trim()

  useEffect(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > NOTE_COLLAPSED_PX + 24)
  }, [markdown])

  // react-markdown without a raw-HTML plugin: any HTML in the note shows as
  // text, which is the point.
  return (
    <div>
      <div
        ref={ref}
        className="overflow-hidden text-[13px] leading-relaxed text-ink-2"
        style={
          overflows && !open
            ? {
                maxHeight: NOTE_COLLAPSED_PX,
                maskImage: "linear-gradient(to bottom, black 65%, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, black 65%, transparent)",
              }
            : undefined
        }
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={NOTE_MARKDOWN}>
          {markdown}
        </ReactMarkdown>
      </div>
      {overflows && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 text-[12px] text-ink-2 hover:text-ink cursor-pointer">
          {open ? "Show less" : "Show more"}
        </button>
      )}
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
