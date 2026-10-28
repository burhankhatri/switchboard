/**
 * Tests for buildAgentHistory.
 *
 * Since sandboxes delete themselves when they stop (5 idle minutes), a reply
 * after a pause lands in a fresh sandbox with no agent conversation on disk,
 * and ensureSandboxForChat drops the session pointer. Unless the chat's own
 * history is replayed, the agent starts with nothing but the new message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const findMany = vi.fn()
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    message: {
      findFirst: (args: unknown) => findFirst(args),
      findMany: (args: unknown) => findMany(args),
    },
  },
}))

import {
  buildAgentHistory,
  capHistory,
  REPLAY_MAX_CHARS,
  REPLAY_MAX_MESSAGE_CHARS,
} from "./history"
import type { ChatRecord, MessagePayload } from "./types"

// ensureSandboxForChat sets sessionId to null whenever it builds a sandbox, for
// a message or for a git action, so "no session to resume" is the signal.
const lostSession = { id: "chat-1", parentChatId: null, sessionId: null } as unknown as ChatRecord
const liveSession = { id: "chat-1", parentChatId: null, sessionId: "ses_abc" } as unknown as ChatRecord
const payload = { agent: "opencode" } as unknown as MessagePayload

const priorMessages = [
  { role: "user", content: "find the electricians in Leeds" },
  { role: "assistant", content: "Found 42 electricians; 12 have emails." },
  { role: "user", content: "push the 12 to the campaign" },
  { role: "assistant", content: "Waiting on your approval to push 12 contacts." },
]

beforeEach(() => {
  findFirst.mockReset()
  findMany.mockReset()
  findMany.mockResolvedValue(priorMessages)
})

describe("buildAgentHistory — session lost mid-chat", () => {
  it("replays the chat's own history when there is no session to resume", async () => {
    findFirst.mockResolvedValue({ agent: "opencode" })

    const result = await buildAgentHistory("chat-1", lostSession, payload)

    expect(result.isAgentSwitch).toBe(false)
    expect(result.history).toEqual(priorMessages)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: "chat-1" } })
    )
  })

  it("replays nothing on a chat's first message, even though its sandbox is new", async () => {
    findFirst.mockResolvedValue(null)

    const result = await buildAgentHistory("chat-1", lostSession, payload)

    expect(result.history).toBeUndefined()
  })

  it("replays nothing when the agent can resume its own session", async () => {
    findFirst.mockResolvedValue({ agent: "opencode" })

    const result = await buildAgentHistory("chat-1", liveSession, payload)

    expect(result.history).toBeUndefined()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("keeps the agent-switch replay as before", async () => {
    findFirst.mockResolvedValue({ agent: "claude-code" })

    const result = await buildAgentHistory("chat-1", liveSession, payload)

    expect(result.isAgentSwitch).toBe(true)
    expect(result.history).toEqual(priorMessages)
  })

  it("caps a long chat's replay to its most recent messages", async () => {
    findFirst.mockResolvedValue({ agent: "opencode" })
    const long = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} ` + "x".repeat(2_000),
    }))
    findMany.mockResolvedValue(long)

    const { history } = await buildAgentHistory("chat-1", lostSession, payload)

    const total = history!.reduce((n, m) => n + m.content.length, 0)
    expect(total).toBeLessThanOrEqual(REPLAY_MAX_CHARS)
    expect(history!.at(-1)!.content.startsWith("message 199 ")).toBe(true)
    expect(history!.length).toBeLessThan(200)
  })
})

describe("capHistory", () => {
  it("keeps everything, in order, when it fits", () => {
    const h = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ]
    expect(capHistory(h)).toEqual(h)
  })

  it("clips one overlong message instead of dropping it", () => {
    const huge = "y".repeat(REPLAY_MAX_MESSAGE_CHARS * 3)
    const [question, reply] = capHistory([
      { role: "user", content: "summarise the sheet" },
      { role: "assistant", content: huge },
    ])
    expect(question.content).toBe("summarise the sheet")
    expect(reply.content.length).toBeLessThanOrEqual(REPLAY_MAX_MESSAGE_CHARS)
    expect(reply.content).toMatch(/truncated/)
  })

  it("starts the replay on a user message so the agent never sees a reply without its question", () => {
    const h = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "z".repeat(REPLAY_MAX_MESSAGE_CHARS - 10),
    }))
    const capped = capHistory(h)
    expect(capped[0].role).toBe("user")
  })
})
