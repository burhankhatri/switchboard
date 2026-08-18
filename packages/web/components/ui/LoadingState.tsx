"use client"

import { useEffect, useState } from "react"

/**
 * Pixel-grid loader for work that takes long enough to need reassurance.
 *
 * Replaces the literal `...` that stood in for every wait in this app. The
 * elapsed timer is the part that matters: sandbox creation and agent turns run
 * for tens of seconds, and a static indicator gives no way to tell "thinking"
 * from "wedged". A number that keeps moving does.
 *
 * Variants:
 *   Drive — square cells, a chevron wavefront driving right. The 650ms cycle is
 *           shorter than the sweep, so two fronts are always in flight.
 *   Dots  — same wavefront, circular cells.
 *   Orbit — a single comet lapping the grid perimeter.
 *
 * Reduced motion is handled globally in globals.css, which freezes the grid;
 * the timer still ticks, because the elapsed time is information, not decoration.
 */

/**
 * Per-cell delay for the chevron. Distance from the left edge plus distance
 * from the middle row, so the wavefront leans forward as it travels.
 */
const chevron = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3)
  const col = i % 3
  return (col + Math.abs(row - 1)) * 90
})

/** Perimeter walk, clockwise from the top-left. The centre cell stays dim. */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const orbit = Array.from({ length: 9 }, (_, i) => {
  const step = ORBIT_ORDER.indexOf(i)
  return step === -1 ? null : step * 110
})

export type LoaderVariant = "Drive" | "Dots" | "Orbit"

const PATTERNS: Record<
  LoaderVariant,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
}

function LoaderGrid({
  delays,
  dur,
  round,
}: {
  delays: (number | null)[]
  dur: number
  round: boolean
}) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`size-[4px] bg-ink ${round ? "rounded-full" : "rounded-[1px]"}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation:
              delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Elapsed time since mount, tenths of a second.
 *
 * Counts its own ticks rather than diffing against a start timestamp — the
 * component is mounted for the duration of the thing it describes, and a
 * counter cannot drift backwards if the clock changes under it.
 */
function useElapsed(startedAt?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])

  const [mountedAt] = useState(() => Date.now())
  const total = Math.max(0, (now - (startedAt ?? mountedAt)) / 1000)
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

export interface LoadingStateProps {
  /** What is happening, in the present participle. Defaults to "Working". */
  label?: string
  variant?: LoaderVariant
  /**
   * When the work began, if it started before this mounted — e.g. a run that
   * was already in flight when the page loaded. Defaults to mount time.
   */
  startedAt?: number
  className?: string
}

export function LoadingState({
  label = "Working",
  variant = "Drive",
  startedAt,
  className = "",
}: LoadingStateProps) {
  const elapsed = useElapsed(startedAt)
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive

  return (
    <div role="status" className={`flex w-fit items-center gap-2.5 ${className}`}>
      <LoaderGrid delays={delays} dur={dur} round={round} />
      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  )
}

export default LoadingState
