"use client"

import { CheckCircle2, Info, TriangleAlert, XCircle, type LucideIcon } from "lucide-react"
import type { Tone } from "@/lib/workspace-home/widgets"
import { cn } from "@/lib/utils"

// Colour marks how a point reads; the icon says it too, so nothing rests on
// hue alone. Text stays in the ink tokens — tinted text on a tinted ground
// is where these fall under contrast.
export const TONE: Record<Tone, { icon: LucideIcon; fg: string; bg: string; dot: string; label: string }> = {
  good: { icon: CheckCircle2, fg: "text-green", bg: "bg-green/10", dot: "bg-green", label: "Good" },
  warn: { icon: TriangleAlert, fg: "text-accent-ink", bg: "bg-accent-tint", dot: "bg-primary", label: "Watch" },
  bad: { icon: XCircle, fg: "text-destructive", bg: "bg-destructive/10", dot: "bg-destructive", label: "Problem" },
  info: {
    icon: Info,
    fg: "text-[var(--series-1)]",
    bg: "bg-[var(--series-1)]/10",
    dot: "bg-[var(--series-1)]",
    label: "Note",
  },
}

export function ToneIcon({ tone, className }: { tone: Tone | undefined; className?: string }) {
  if (!tone) {
    return <span aria-hidden className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3", className)} />
  }
  const { icon: Icon, fg, label } = TONE[tone]
  return <Icon aria-label={label} className={cn("h-4 w-4 shrink-0", fg, className)} />
}

/**
 * How a status word in a table reads. Agents write whatever their source
 * calls it ("Draft", "status 0", "Paused (manual)"), so this matches on
 * stems; anything unrecognised stays neutral rather than guessing.
 */
export function statusTone(value: string): Tone | undefined {
  const v = value.toLowerCase()
  if (/fail|error|bounc|broken|blocked|disconnect/.test(v)) return "bad"
  if (/draft|pending|waiting|review|paused|queued|needs/.test(v)) return "warn"
  if (/active|running|live|sending|healthy|won/.test(v)) return "good"
  return undefined
}
