"use client"

import { cn } from "@/lib/utils"

/**
 * Text arriving token by token.
 *
 * The caret is the whole point: without it a paused stream and a finished
 * answer look identical, so people re-send. It renders on a trailing space so
 * it never overlaps the last glyph.
 */
export function StreamingText({
  text,
  streaming,
  className,
}: {
  text: string
  streaming: boolean
  className?: string
}) {
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {text}
      {streaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-primary animate-pulse"
        />
      )}
    </span>
  )
}

/**
 * Placeholder shown between "the turn started" and "the first token arrived".
 * Elapsed time is shown because that gap can run to tens of seconds while a
 * sandbox boots, and a silent screen reads as broken.
 */
export function StreamingPending({ startedAt }: { startedAt: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-current animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <Elapsed from={startedAt} />
    </span>
  )
}

function Elapsed({ from }: { from: number }) {
  const secs = Math.max(0, Math.round((Date.now() - from) / 1000))
  return <span className="tabular-nums text-xs">{secs}s</span>
}
