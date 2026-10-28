import type { AgentSnapshot } from "@/lib/agent-session"

/**
 * What the assistant message says once a turn is over.
 *
 * A turn can end with the model having said nothing: the provider rejected the
 * run before the first token, the process crashed, or a free-tier gate refused
 * the version in the sandbox. The error used to go to the live SSE banner and
 * the activity log only, so the persisted message was an empty bubble and the
 * person re-sent the prompt. This puts the reason, and when it is known the
 * fix, into the message itself and marks it as an error.
 *
 * A turn that ran tools but wrote no prose is left alone: that is a quiet
 * turn, not a failed one.
 */
export interface FinalTurnContent {
  content: string
  isError: boolean
}

const STOP_PREFIX = "Agent stopped: "

const FREE_TIER_VERSION = /OpenCode\s+(\d+\.\d+(?:\.\d+)?)\s+or newer is required/i

/** A one-line fix for failures where the person can act without reading logs. */
export function describeTurnFailure(error: string | undefined): string {
  const text = (error ?? "").trim()
  if (!text) return "the agent ended without a reply or an error message. Try sending again."
  const version = FREE_TIER_VERSION.exec(text)
  if (version) {
    return (
      `${text}. The free model needs OpenCode ${version[1]} in the sandbox image; ` +
      "pick another model from the model menu, or ask an admin to rebuild the image."
    )
  }
  return text
}

export function finalTurnContent(snapshot: AgentSnapshot): FinalTurnContent {
  const content = snapshot.content ?? ""

  if (snapshot.status === "error") {
    const line = STOP_PREFIX + describeTurnFailure(snapshot.error)
    const above = content.trim() ? content.replace(/\n*$/, "\n\n") : ""
    return { content: above + line + "\n", isError: true }
  }

  if (!content.trim() && snapshot.toolCalls.length === 0) {
    return {
      content:
        STOP_PREFIX +
        "the agent ended this turn with nothing to say and no work done. " +
        "Try sending again; if it repeats, pick another model from the model menu.\n",
      isError: true,
    }
  }

  return { content, isError: false }
}
