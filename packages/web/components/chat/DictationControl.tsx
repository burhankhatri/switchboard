"use client"

import { Microphone, MicrophoneMute, Square } from "iconoir-react"
import { cn } from "@/lib/utils"

interface DictationControlProps {
  isListening: boolean
  permissionDenied: boolean
  /** Latest not-yet-final words, shown so dictation visibly reacts to speech. */
  transcript: string
  error: string | null
  onToggle: () => void
  isMobile?: boolean
}

/**
 * Voice dictation, with enough feedback to tell whether it is actually hearing
 * you.
 *
 * The previous control was a mic button that turned red and pulsed. Two things
 * were wrong with that: a red pulsing button is equally consistent with "armed"
 * and "broken", and the hook has always returned a live interim `transcript`
 * that nothing rendered — so the one signal that proves the microphone is
 * working was being thrown away.
 *
 * While listening this becomes a labelled pill: a level meter that moves, the
 * words heard so far, and a square stop button that says stop rather than
 * asking you to infer it from the mic turning a different colour.
 */
export function DictationControl({
  isListening,
  permissionDenied,
  transcript,
  error,
  onToggle,
  isMobile = false,
}: DictationControlProps) {
  const iconSize = isMobile ? 18 : 16

  if (permissionDenied) {
    return (
      <button
        type="button"
        disabled
        title="Microphone access denied — allow it in your browser settings"
        aria-label="Microphone access denied"
        className="flex size-8 shrink-0 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-50"
      >
        <MicrophoneMute width={iconSize} height={iconSize} />
      </button>
    )
  }

  if (!isListening) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="Dictate prompt"
        aria-label="Start voice dictation"
        aria-pressed={false}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          "text-ink-2 transition-[background-color,color,transform] duration-150",
          "hover:bg-hover hover:text-ink active:scale-[0.94] cursor-pointer"
        )}
      >
        <Microphone width={iconSize} height={iconSize} />
      </button>
    )
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-full bg-accent-tint py-1 pr-1 pl-2.5",
        "text-accent-ink shadow-hairline"
      )}
      style={{ animation: "pop-in 180ms var(--ease-spring) both" }}
    >
      {/* A meter that moves is the proof the microphone is live. */}
      <span aria-hidden className="flex h-3.5 items-center gap-[2.5px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-[2.5px] rounded-full bg-current"
            style={{ height: "100%", animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }}
          />
        ))}
      </span>

      <span className="min-w-0 max-w-[16rem] truncate text-[12px]" aria-live="polite">
        {error ? error : transcript ? transcript : "Listening…"}
      </span>

      <button
        type="button"
        onClick={onToggle}
        title="Stop dictation"
        aria-label="Stop voice dictation"
        aria-pressed
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          "bg-accent-ink text-white transition-transform duration-150",
          "active:scale-[0.94] cursor-pointer"
        )}
      >
        <Square width={10} height={10} fill="currentColor" />
      </button>
    </div>
  )
}
