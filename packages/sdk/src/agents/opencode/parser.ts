/**
 * OpenCode CLI output parser
 *
 * Pure function for parsing OpenCode CLI JSON output.
 * Note: OpenCode requires stateful parsing to track session ID.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, normalizeToolName } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Raw event types from OpenCode's JSON stream
 */
interface OpenCodeStepStart {
  type: "step_start"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "step-start"
  }
}

interface OpenCodeText {
  type: "text"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "text"
    text?: string
  }
}

interface OpenCodeToolCall {
  type: "tool_call"
  sessionID: string
  part?: {
    id: string
    type: "tool-call"
    tool?: string
    args?: unknown
  }
}

interface OpenCodeToolUse {
  type: "tool_use"
  sessionID: string
  part?: {
    id: string
    tool?: string
    state?: { status: string; input?: unknown }
  }
}

interface OpenCodeToolResult {
  type: "tool_result"
  sessionID: string
  part?: {
    id: string
    type: "tool-result"
  }
}

interface OpenCodeStepFinish {
  type: "step_finish"
  sessionID: string
  part?: {
    id: string
    type: "step-finish"
    reason: string
  }
}

interface OpenCodeError {
  type: "error"
  sessionID: string
  error?: {
    name: string
    data?: {
      message: string
    }
  }
}

type OpenCodeEvent =
  | OpenCodeStepStart
  | OpenCodeText
  | OpenCodeToolCall
  | OpenCodeToolUse
  | OpenCodeToolResult
  | OpenCodeStepFinish
  | OpenCodeError

/**
 * Detect a fatal turn failure from OpenCode's plaintext ERROR logs.
 *
 * Why this exists: on a retryable model error (HTTP 429 rate-limit / usage
 * limit, overloaded, transient network), OpenCode does NOT emit a JSON `error`
 * event — it retries with backoff, writing only plaintext `ERROR …` lines to
 * its logs. With nothing terminal on stdout, the turn never ends and the UI
 * spins on the "generating" indicator forever. We surface the failure instead
 * (matching how the Claude agent surfaces a limit) so the user sees the error.
 *
 * OpenCode logs a *cluster* of lines for one failure. We key off two:
 *
 *   1. `service=session.processor error=<message> …` — the TERMINAL, turn-level
 *      failure with a human-readable message, e.g.
 *      `error=Monthly usage limit reached. Resets in 10 days. To continue …`.
 *      This is the highest-signal line: it appears once when the turn gives up,
 *      and its message is exactly what the user needs. We surface it
 *      immediately (no grace) — waiting is what produced the perceived hang.
 *
 *   2. `service=llm … error={"error":{"name":…,"statusCode":…}}` — a per-attempt
 *      model-call error. Used only as a FALLBACK when no processor line appears.
 *      We require TWO before terminating (one retry of grace) and skip the
 *      title/summary sidecar (a separate cheap-model call that can fail on
 *      billing without the main turn being affected — surfacing it would be a
 *      false positive). The `error={…}` blob embeds the full request body, so we
 *      pull only high-signal fields by regex rather than JSON.parsing it.
 *
 * Tool/bash ERROR logs and the title-generation sidecar are intentionally
 * ignored: the turn can recover from them.
 */
/**
 * Attempts OpenCode 1.18.x makes at one model-call step before giving up
 * (RETRY_MAX_RETRIES = 5 in its session/retry.ts, plus the first try).
 */
const OPENCODE_STEP_ATTEMPTS = 6

/**
 * Stream errors OpenCode itself retries: a provider that sends no headers or
 * stops streaming, a 5xx, or a dropped connection. Mirrors the retryable set in
 * OpenCode's session/retry.ts. Usage limits, auth and balance errors are not
 * here: OpenCode does not retry those, so they must end the turn at once.
 */
const RETRYABLE_STREAM_ERROR =
  /Provider(HeaderTimeout|ResponseStream)Error|ResponseStreamError|response headers timed out|SSE read timed out|\b50[0234]\b|\b524\b|overloaded|server_error|ECONNRESET|socket hang up|fetch failed/i

function parseOpencodeLogError(line: string, context: ParseContext): Event | null {
  if (context.state.llmErrorEmitted) return null

  // ── Format A: structured logfmt (what `opencode run` writes in production) ──
  //   timestamp=… level=ERROR … message="stream error" … modelID=… small=false
  //   agent=build mode=primary error.error="AI_APICallError: Monthly usage limit
  //   reached. …"
  // One line per failed model-call attempt. What happens next depends on the
  // error:
  //   - Retryable (provider stall, stalled stream, 5xx, dropped connection):
  //     OpenCode 1.18.x retries it itself, up to OPENCODE_STEP_ATTEMPTS times
  //     with backoff, and writes one of these lines per attempt. Ending the turn
  //     here killed runs OpenCode was about to recover (a replay of the
  //     2026-09-25 gtm-lead-engine turn answered 2.6s after the first timeout),
  //     so we let it retry and end only once it has spent its attempts on one
  //     step. JSON progress between failures resets the count (see
  //     parseOpencodeLine), because the budget is per step.
  //   - Anything else (usage limits, the free-tier version gate, auth,
  //     balance): nothing more arrives, so surface it at once.
  // The title/summary sidecar runs as `agent=title small=true`; ignore it so its
  // own failure (e.g. a billing error on the default model) can't end the turn.
  if (/\blevel=ERROR\b/.test(line) && /\bmessage="stream error"/.test(line)) {
    const isSidecar = /\bagent=(title|summary)\b/.test(line) || /\bsmall=true\b/.test(line)
    if (isSidecar) return null
    const raw = line.match(/\berror\.error="((?:[^"\\]|\\.)*)"/)?.[1]
    // Drop the noisy `AI_XxxError: ` / retry-wrapper prefixes for a clean message.
    const msg = raw
      ?.replace(/^AI_\w+:\s*/, "")
      .replace(/^Failed after \d+ attempts?\.\s*Last error:\s*/i, "")
      .trim()
    if (raw && RETRYABLE_STREAM_ERROR.test(raw)) {
      const stalls = ((context.state.transientStreamErrors as number) ?? 0) + 1
      context.state.transientStreamErrors = stalls
      if (stalls < OPENCODE_STEP_ATTEMPTS) return null
    }
    context.state.llmErrorEmitted = true
    return { type: "end", error: resolveAgentError(msg || raw || "the model request failed", "opencode") }
  }

  // ── Format B: pretty logs (`ERROR <date> +Nms service=…`) ──
  if (!/^ERROR\b/.test(line)) return null

  // Title/summary generation runs as a separate cheap-model call. Its failures
  // (e.g. a billing 401 on the paid default model) must never end the turn.
  const isTitleSidecar = /\btitle\b|\bsummar/i.test(line) || /You are a title generator/i.test(line)

  // (1) Terminal turn-level failure — surface immediately with its message.
  if (/\bservice=session\.processor\b/.test(line) && !isTitleSidecar) {
    const msg = line.match(/\berror=(.*?)(?:\s+stack=.*)?$/)?.[1]?.trim()
    context.state.llmErrorEmitted = true
    return { type: "end", error: resolveAgentError(msg || "the turn failed", "opencode") }
  }

  // (2) Fallback: repeated model-call (service=llm) errors with no processor line.
  if (!/\bservice=llm\b/.test(line) || isTitleSidecar) return null

  const count = ((context.state.llmErrorCount as number) ?? 0) + 1
  context.state.llmErrorCount = count
  // Grace: tolerate a single failure (OpenCode will retry); act on the second.
  if (count < 2) return null
  context.state.llmErrorEmitted = true

  // High-signal fields from the `error={…}` JSON, by regex (no full parse).
  const name = line.match(/error=\{"error":\{"name":"([^"]+)"/)?.[1]
  const status = line.match(/"statusCode":\s*(\d+)/)?.[1]
  const causeCode = line.match(/"cause":\{[^}]*"code":"([^"]+)"/)?.[1]
  const parts = [name, status ? `HTTP ${status}` : null, causeCode].filter(Boolean)
  const raw = parts.join(" ") || "the model request failed repeatedly"

  return { type: "end", error: resolveAgentError(raw, "opencode") }
}

/**
 * Parse a line of OpenCode CLI output into event(s).
 *
 * Uses context.state.seenSessionId to track if session event was already emitted.
 */
export function parseOpencodeLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<OpenCodeEvent>(line)
  if (!json) {
    // Non-JSON line: OpenCode's plaintext logs. A repeated model-call failure
    // here is the only signal during an otherwise-silent retry hang.
    return parseOpencodeLogError(line, context)
  }

  // Any JSON event means the step made progress, so OpenCode's retry budget
  // (per step) starts again.
  context.state.transientStreamErrors = 0

  // Step start - session initialization
  if (json.type === "step_start") {
    // OpenCode can emit multiple step_start lines for the same session; only emit once
    if (context.sessionId === json.sessionID) return null
    context.sessionId = json.sessionID
    return { type: "session", id: json.sessionID }
  }

  // Text content - the actual response
  if (json.type === "text") {
    if (json.part?.type === "text" && json.part.text) {
      return { type: "token", text: json.part.text }
    }
    return null
  }

  // Tool call start
  if (json.type === "tool_call") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    return createToolStartEvent(normalized, json.part?.args, toolMappings)
  }

  // Tool use (stream-json: emitted when tool completes with full state)
  if (json.type === "tool_use") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    const raw = json.part as { state?: { status?: string; input?: unknown; output?: string } } | undefined
    const startEvent = createToolStartEvent(normalized, raw?.state?.input, toolMappings)

    // If the tool already completed (state.output is present), emit tool_end inline.
    // This is the common case for OpenCode: tool_use carries the full result.
    const rawOutput = raw?.state?.output
    if (typeof rawOutput === "string" && rawOutput.trim()) {
      return [startEvent, { type: "tool_end", output: rawOutput.trim() }]
    }
    return startEvent
  }

  // Tool result - tool completed (streaming / in-progress path, no output here)
  if (json.type === "tool_result") {
    return { type: "tool_end" }
  }

  // Step finish - emit end only when run actually stops
  if (json.type === "step_finish") {
    if (json.part?.reason === "stop") return { type: "end" }
    return null
  }

  // Error event - emit as end with error
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json, "opencode") }
  }

  return null
}
