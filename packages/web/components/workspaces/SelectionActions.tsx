"use client"

import { useEffect, useRef, useState } from "react"
import {
  ChatBubbleQuestion,
  Check,
  EmojiSatisfied,
  NavArrowRight,
  Refresh,
  Scissor,
  Spark,
  TextBox,
  Xmark,
} from "iconoir-react"
import { cn } from "@/lib/utils"

type Mode = "idle" | "thinking" | "result"

const iconProps = { width: 14, height: 14, strokeWidth: 1.8, "aria-hidden": true } as const

const PRESETS = [
  { key: "explain", label: "Explain", icon: <ChatBubbleQuestion {...iconProps} /> },
  { key: "improve", label: "Improve", icon: <Spark {...iconProps} /> },
  { key: "shorten", label: "Shorten", icon: <Scissor {...iconProps} /> },
  { key: "tone", label: "Tone", icon: <EmojiSatisfied {...iconProps} /> },
  { key: "grammar", label: "Grammar", icon: <TextBox {...iconProps} /> },
] as const

/** The first two are always visible; the rest live behind the chevron. */
const PRIMARY_COUNT = 2

const control =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] text-ink " +
  "transition-[background-color,color,transform] duration-150 hover:bg-hover active:scale-[0.96] cursor-pointer"

const primary =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink px-2.5 text-[12.5px] text-white " +
  "shadow-hairline transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.96] cursor-pointer"

export interface SelectionActionsProps {
  workspaceId: string
  /** The currently selected text. The bar hides when this is empty. */
  selection: string
  /** Replace the selection with the accepted rewrite. */
  onApply: (replacement: string) => void
  /** Called when the user dismisses without applying. */
  onDismiss: () => void
}

/**
 * Contextual edit bar for a selection inside a workspace file.
 *
 * Anchored under the editor rather than under the selected line. A textarea
 * exposes no client rects for its selection, so line-accurate anchoring needs a
 * mirrored element measured in parallel — worth doing for prose, not worth the
 * failure modes for a file editor where the bar is a couple of centimetres from
 * the text either way.
 *
 * Nothing is written until Keep. Discard and Retry leave the file untouched, so
 * a rewrite that comes back wrong costs one click.
 */
export function SelectionActions({
  workspaceId,
  selection,
  onApply,
  onDismiss,
}: SelectionActionsProps) {
  const [mode, setMode] = useState<Mode>("idle")
  const [expanded, setExpanded] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [result, setResult] = useState("")
  const [action, setAction] = useState("improve")
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // A new selection invalidates whatever the last one produced.
  useEffect(() => {
    setMode("idle")
    setResult("")
    setError(null)
    setExpanded(false)
  }, [selection])

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!selection) return null

  const run = async (instruction: string) => {
    setAction(instruction)
    setExpanded(false)
    setMode("thinking")
    setError(null)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/edit-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, instruction }),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Could not edit")
      }
      const data = (await res.json()) as { text: string; unchanged: boolean }
      if (data.unchanged) {
        // The helper returns the input unchanged when no key is configured.
        // Saying so beats presenting a no-op as a result.
        setError("Text editing is not configured on this deployment.")
        setMode("idle")
        return
      }
      setResult(data.text)
      setMode("result")
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      setError((e as Error).message)
      setMode("idle")
    }
  }

  const busyLabel =
    action === "improve"
      ? "Improving"
      : action === "shorten"
        ? "Shortening"
        : action === "tone"
          ? "Changing tone"
          : action === "grammar"
            ? "Fixing grammar"
            : action === "explain"
              ? "Explaining"
              : "Editing"

  return (
    <div className="mt-3 space-y-2" data-testid="selection-actions">
      <div
        className={cn(
          "flex h-9 w-fit max-w-full items-center gap-0.5 overflow-hidden rounded-full",
          "bg-surface p-1 text-ink shadow-overlay"
        )}
        style={{ animation: "pop-in 220ms var(--ease-spring) both" }}
      >
        {mode === "thinking" && (
          <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap px-2.5 text-[12.5px] text-ink-2">
            <span
              className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
              style={{ animation: "spin 700ms linear infinite" }}
            />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {busyLabel}…
            </span>
          </span>
        )}

        {mode === "result" && (
          <>
            <button
              type="button"
              className={primary}
              onClick={() => {
                onApply(result)
                setMode("idle")
              }}
            >
              <Check {...iconProps} />
              Keep
            </button>
            <button type="button" className={control} onClick={onDismiss}>
              <Xmark {...iconProps} />
              Discard
            </button>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-line" />
            <button
              type="button"
              aria-label="Try again"
              onClick={() => run(action)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink-2 cursor-pointer"
            >
              <Refresh {...iconProps} />
            </button>
          </>
        )}

        {mode === "idle" && (
          <>
            <form
              className="flex h-7 shrink-0 items-center"
              onSubmit={(e) => {
                e.preventDefault()
                run(prompt.trim() || "improve")
              }}
            >
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="Describe the edit"
                placeholder="Describe edits"
                className="h-7 w-36 bg-transparent pr-2 pl-3 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </form>

            <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />

            {PRESETS.slice(0, PRIMARY_COUNT).map((p) => (
              <button key={p.key} type="button" className={control} onClick={() => run(p.key)}>
                {p.icon}
                {p.label}
              </button>
            ))}

            <div
              className="flex min-w-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-400"
              style={{
                maxWidth: expanded ? 320 : 0,
                opacity: expanded ? 1 : 0,
                transitionTimingFunction: "var(--ease-spring)",
              }}
            >
              {PRESETS.slice(PRIMARY_COUNT).map((p) => (
                <button key={p.key} type="button" className={control} onClick={() => run(p.key)}>
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>

            <span className="mx-0.5 h-4 w-px shrink-0 bg-line" />
            <button
              type="button"
              aria-label={expanded ? "Show fewer actions" : "Show more actions"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink transition-[background-color] duration-200 hover:bg-hover cursor-pointer"
            >
              <span
                className="flex transition-transform duration-400"
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transitionTimingFunction: "var(--ease-spring)",
                }}
              >
                <NavArrowRight {...iconProps} />
              </span>
            </button>
          </>
        )}
      </div>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      {/* The rewrite is shown before it is applied — nothing is written to the
          file until Keep, so a wrong answer costs a click rather than an undo. */}
      {mode === "result" && (
        <div
          className="streaming-markdown rounded-xl border border-line bg-inset p-3 font-mono text-[12px] whitespace-pre-wrap text-ink"
          style={{ animation: "fade-up 300ms var(--ease-spring) both" }}
        >
          {result}
        </div>
      )}
    </div>
  )
}
