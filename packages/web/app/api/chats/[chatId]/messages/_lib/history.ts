import { prisma } from "@/lib/db/prisma"
import type { ChatRecord, MessagePayload } from "./types"

type HistoryMessage = { role: "user" | "assistant"; content: string }
type AgentHistory = HistoryMessage[]

export interface AgentHistoryResult {
  history: AgentHistory | undefined
  /** True when the incoming agent differs from the one that produced the last assistant message. */
  isAgentSwitch: boolean
}

/** Most characters of replayed history a recreated sandbox's first turn carries. */
export const REPLAY_MAX_CHARS = 40_000
/** Longest single message kept whole in a replay; longer ones are clipped. */
export const REPLAY_MAX_MESSAGE_CHARS = 8_000
const TRUNCATED = "\n[…truncated]"

/**
 * Bound a replay to the most recent messages that fit in REPLAY_MAX_CHARS,
 * clipping any single message over REPLAY_MAX_MESSAGE_CHARS. The replay always
 * opens on a user message, so the agent never reads a reply without the
 * question it answered.
 */
export function capHistory(history: readonly HistoryMessage[]): AgentHistory {
  const kept: AgentHistory = []
  let total = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const content =
      m.content.length > REPLAY_MAX_MESSAGE_CHARS
        ? m.content.slice(0, REPLAY_MAX_MESSAGE_CHARS - TRUNCATED.length) + TRUNCATED
        : m.content
    if (total + content.length > REPLAY_MAX_CHARS) break
    total += content.length
    kept.unshift({ role: m.role, content })
  }
  while (kept.length > 0 && kept[0].role !== "user") kept.shift()
  return kept
}

async function chatHistory(chatId: string): Promise<AgentHistory> {
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { timestamp: "asc" },
    select: { role: true, content: true },
  })
  return messages
    .filter(
      (m): m is typeof m & { role: "user" | "assistant" } =>
        (m.role === "user" || m.role === "assistant") && !!m.content.trim()
    )
    .map((m) => ({ role: m.role, content: m.content }))
}

/**
 * Decide what prior conversation (if any) to replay to the agent for this turn,
 * and whether this is an agent switch.
 *
 * Three sources, in priority order:
 *  - Agent switch: the incoming agent differs from the one that produced the
 *    most recent assistant message — replay this chat's own history so the new
 *    CLI has context. (Per-message agent fields are immutable, so this still
 *    works after the dropdown already PATCHed chat.agent.)
 *  - Session lost mid-chat: the chat already has assistant turns but no session
 *    to resume. ensureSandboxForChat drops the pointer whenever it rebuilds a
 *    sandbox (sandboxes delete themselves when they stop, after 5 idle
 *    minutes, and a git action can rebuild one too), because the agent's own
 *    saved conversation lived in the old sandbox. Replay a capped copy of this
 *    chat's history. Only message text survives; tool results do not.
 *  - Chat fork: the chat was forked from a parent and has no assistant message
 *    yet — replay the parent's conversation for the first message.
 *
 * Runs before the incoming message is persisted, so the replay never repeats it.
 */
export async function buildAgentHistory(
  chatId: string,
  chat: ChatRecord,
  payload: MessagePayload
): Promise<AgentHistoryResult> {
  const lastAssistant = await prisma.message.findFirst({
    where: { chatId, role: "assistant" },
    orderBy: { timestamp: "desc" },
    select: { agent: true },
  })
  const isAgentSwitch =
    !!lastAssistant?.agent && lastAssistant.agent !== payload.agent

  let history: AgentHistory | undefined

  if (isAgentSwitch) {
    history = await chatHistory(chatId)
    if (history.length === 0) history = undefined
    else
      console.log(
        `[chats/messages] Agent switch detected: injecting ${history.length} history messages`
      )
  } else if (lastAssistant && !chat.sessionId) {
    history = capHistory(await chatHistory(chatId))
    if (history.length === 0) history = undefined
    else
      console.log(
        `[chats/messages] No session to resume: injecting ${history.length} history messages`
      )
  }

  // When a chat is forked from a parent (via /branch, Option+Enter, etc.),
  // the first message should include the parent's conversation history so
  // the agent has context about what was previously discussed.
  if (!history && chat.parentChatId && !lastAssistant) {
    history = await chatHistory(chat.parentChatId)
    if (history.length === 0) history = undefined
    else
      console.log(
        `[chats/messages] Chat fork detected: injecting ${history.length} parent messages`
      )
  }

  return { history, isAgentSwitch }
}
