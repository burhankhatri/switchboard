"use client"

import { useState } from "react"
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Info,
  type LucideIcon,
} from "lucide-react"
import type {
  ActionsContent,
  FunnelContent,
  KpisContent,
  SummaryContent,
  TimelineContent,
} from "@/lib/workspace-home/widgets"
import { cn } from "@/lib/utils"
import { WidgetFooter } from "./bodies"
import { TONE, ToneIcon } from "./tone"

const fmt = (v: number | string) => (typeof v === "number" ? v.toLocaleString() : v)

function Change({ change }: { change: NonNullable<KpisContent["items"][number]["change"]> }) {
  // Neutral on purpose: up is not always good (costs, bounces), and the
  // widget cannot know which.
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : ArrowRight
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-inset px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-2">
      <Icon className="h-3 w-3" />
      {change.value}
    </span>
  )
}

export function SummaryBody({ content }: { content: SummaryContent }) {
  const points = content.points ?? []
  return (
    <div>
      <p className="font-display text-[22px] leading-snug tracking-tight text-ink sm:text-[26px]">
        {content.headline}
      </p>
      {points.length > 0 && (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {points.map((p, i) => (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-snug text-ink",
                p.tone ? TONE[p.tone].bg : "bg-inset"
              )}
            >
              <ToneIcon tone={p.tone} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function KpisBody({ content }: { content: KpisContent }) {
  const n = content.items.length
  return (
    <div>
      <div
        className={cn(
          "grid gap-px overflow-hidden rounded-xl bg-line",
          n === 1 ? "grid-cols-1" : n === 2 || n === 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
          n === 4 && "lg:grid-cols-4"
        )}
      >
        {content.items.map((k, i) => (
          <div key={i} className="flex min-w-0 flex-col bg-surface px-4 py-3.5">
            <span className="truncate text-[12px] text-ink-2" title={k.label}>
              {k.label}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <span className="font-display text-[28px] leading-none tabular-nums tracking-tight text-ink">
                {fmt(k.value)}
              </span>
              {k.unit && <span className="text-[12px] text-ink-3">{k.unit}</span>}
            </span>
            {(k.change || k.hint) && (
              <span className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                {k.change && <Change change={k.change} />}
                {k.hint && (
                  <span className="line-clamp-2 text-[11px] leading-snug text-ink-3" title={k.hint}>
                    {k.hint}
                  </span>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      {content.asOf && <p className="mt-2 text-[11px] text-ink-3">As of {content.asOf}</p>}
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

export function FunnelBody({ content }: { content: FunnelContent }) {
  const max = Math.max(...content.steps.map((s) => s.value), 1)
  return (
    <div>
      <ol className="space-y-1">
        {content.steps.map((s, i) => {
          const prev = i > 0 ? content.steps[i - 1].value : null
          const rate = prev ? Math.round((s.value / prev) * 1000) / 10 : null
          return (
            <li key={i}>
              {rate !== null && (
                <p className="py-0.5 pl-1 text-[11px] tabular-nums text-ink-3">↓ {rate}% carry on</p>
              )}
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[12px] text-ink-2" title={s.label}>
                  {s.label}
                </span>
                <span className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-inset">
                  <span
                    className="absolute inset-y-0 left-0 rounded-md bg-[var(--series-1)]"
                    style={{ width: `${Math.max((s.value / max) * 100, 1.5)}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-[13px] font-medium tabular-nums text-ink">
                  {s.value.toLocaleString()}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}

const TIMELINE_PREVIEW = 6

export function TimelineBody({ content }: { content: TimelineContent }) {
  const [all, setAll] = useState(false)
  const events = all ? content.events : content.events.slice(0, TIMELINE_PREVIEW)
  const hidden = content.events.length - events.length
  return (
    <div>
      <ol>
        {events.map((e, i) => (
          <li key={i} className="grid grid-cols-[4.5rem_1rem_1fr] gap-x-3">
            <span className="pt-0.5 text-right text-[11px] leading-5 tabular-nums text-ink-3">{e.date}</span>
            <span className="relative flex justify-center">
              {/* The rail runs through every dot but the last, so the line ends where history does. */}
              {i < events.length - 1 && <span aria-hidden className="absolute top-3 bottom-0 w-px bg-line-strong" />}
              <span
                aria-hidden
                className={cn(
                  "relative mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface",
                  e.tone ? TONE[e.tone].dot : "bg-ink-3"
                )}
              />
            </span>
            <div className={cn("min-w-0", i < events.length - 1 ? "pb-4" : "")}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5 text-ink">
                <span className="font-medium">{e.title}</span>
                {e.who && <span className="text-[11px] text-ink-3">{e.who}</span>}
              </p>
              {e.detail && <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{e.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
      {(hidden > 0 || all) && content.events.length > TIMELINE_PREVIEW && (
        <button
          onClick={() => setAll((v) => !v)}
          className="mt-1 ml-[6.5rem] text-[12px] text-ink-2 hover:text-ink cursor-pointer"
        >
          {all ? "Show fewer" : `Show ${hidden} earlier`}
        </button>
      )}
    </div>
  )
}

const URGENCY: Record<
  ActionsContent["items"][number]["urgency"],
  { label: string; icon: LucideIcon; cls: string }
> = {
  now: { label: "Now", icon: AlertCircle, cls: "bg-destructive/10 text-destructive" },
  soon: { label: "Soon", icon: Clock, cls: "bg-accent-tint text-accent-ink" },
  fyi: { label: "FYI", icon: Info, cls: "bg-inset text-ink-2" },
}

export function ActionsBody({ content }: { content: ActionsContent }) {
  return (
    <ul className="divide-y divide-line">
      {content.items.map((a, i) => {
        const u = URGENCY[a.urgency]
        return (
          <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={cn(
                "mt-px inline-flex w-[3.75rem] shrink-0 items-center justify-center gap-1 rounded-full py-0.5 text-[11px] font-medium",
                u.cls
              )}
            >
              <u.icon className="h-3 w-3" />
              {u.label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug text-ink">{a.title}</p>
              {a.detail && <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{a.detail}</p>}
              {(a.owner || a.since) && (
                <p className="mt-1 text-[11px] text-ink-3 sm:hidden">
                  {[a.owner && `Waiting on ${a.owner}`, a.since && `since ${a.since}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            {(a.owner || a.since) && (
              <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
                {a.owner && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                    <span
                      aria-hidden
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-inset text-[10px] font-medium uppercase text-ink-2"
                    >
                      {a.owner.slice(0, 1)}
                    </span>
                    {a.owner}
                  </span>
                )}
                {a.since && <span className="text-[11px] text-ink-3">since {a.since}</span>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
