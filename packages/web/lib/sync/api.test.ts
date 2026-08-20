import { describe, it, expect } from "vitest"
import { toChatType, type ChatResponse } from "./api"
import { isChatVisibleForFilter } from "@/lib/chat-tree"
import { ALL_REPOSITORIES } from "@/lib/contexts/SidebarContext"

/**
 * toChatType is the only place a server chat becomes a client chat, so a field
 * it forgets is a field the entire UI behaves as if the server never sent.
 *
 * workspaceId in particular: the sidebar and the home page filter on it, and
 * dropping it made every chat invisible the moment a workspace was opened —
 * silently, because "no chats in this workspace" is a legitimate state and
 * looks identical to the bug.
 */

function serverChat(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    id: "c1",
    repo: "owner/repo",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    previewUrlPattern: null,
    backgroundSessionId: null,
    agent: "claude",
    model: null,
    planModeEnabled: false,
    displayName: "A chat",
    shareId: null,
    status: "ready",
    archived: false,
    pinned: false,
    parentChatId: null,
    needsSync: false,
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    lastActiveAt: 1,
    ...overrides,
  } as ChatResponse
}

describe("toChatType", () => {
  it("carries workspaceId through", () => {
    const chat = toChatType(serverChat({ workspaceId: "w1" }))
    expect(chat.workspaceId).toBe("w1")
  })

  it("leaves an unbound chat unbound rather than inventing a workspace", () => {
    const chat = toChatType(serverChat({ workspaceId: null }))
    expect(chat.workspaceId ?? null).toBeNull()
  })

  it("carries awaitingInput through", () => {
    expect(toChatType(serverChat({ awaitingInput: true })).awaitingInput).toBe(true)
    expect(toChatType(serverChat()).awaitingInput).toBe(false)
  })
})

describe("toChatType + isChatVisibleForFilter", () => {
  it("shows a workspace's own chat when that workspace is open", () => {
    // The regression this pair exists for: with workspaceId dropped in the
    // mapping, this returned false for every chat and the sidebar rendered
    // empty in every workspace.
    const chat = toChatType(serverChat({ workspaceId: "w1" }))
    expect(isChatVisibleForFilter(chat, ALL_REPOSITORIES, "w1")).toBe(true)
  })

  it("still hides another workspace's chat", () => {
    const chat = toChatType(serverChat({ workspaceId: "w2" }))
    expect(isChatVisibleForFilter(chat, ALL_REPOSITORIES, "w1")).toBe(false)
  })

  it("shows every chat when no workspace is open", () => {
    const bound = toChatType(serverChat({ workspaceId: "w1" }))
    const unbound = toChatType(serverChat({ id: "c2", workspaceId: null }))
    expect(isChatVisibleForFilter(bound, ALL_REPOSITORIES, null)).toBe(true)
    expect(isChatVisibleForFilter(unbound, ALL_REPOSITORIES, null)).toBe(true)
  })
})
