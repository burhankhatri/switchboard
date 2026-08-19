import { describe, expect, it } from "vitest"
import { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"
import { NEW_REPOSITORY, type Chat } from "@/lib/types"
import {
  buildTreeOrderedChatIds,
  getChatIdForRepoFilter,
  getNextChatIdAfterDeletion,
  isChatVisibleForFilter,
} from "./chat-tree"

/** Build a minimally-valid Chat with sane defaults, overridable per field. */
function makeChat(overrides: Partial<Chat> & Pick<Chat, "id">): Chat {
  return {
    repo: "octocat/hello",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    messages: [],
    messageCount: 1, // treated as "has messages" unless overridden
    createdAt: 0,
    updatedAt: 0,
    displayName: overrides.id,
    status: "idle" as Chat["status"],
    ...overrides,
  }
}

describe("isChatVisibleForFilter", () => {
  it("hides archived chats under the Active-chats (all repos) filter", () => {
    const archived = makeChat({ id: "a", archived: true })
    expect(isChatVisibleForFilter(archived, ALL_REPOSITORIES)).toBe(false)
  })

  it("shows only archived chats under the Archived filter", () => {
    const active = makeChat({ id: "a", archived: false })
    const archived = makeChat({ id: "b", archived: true })
    expect(isChatVisibleForFilter(active, ARCHIVED_CHATS)).toBe(false)
    expect(isChatVisibleForFilter(archived, ARCHIVED_CHATS)).toBe(true)
  })

  it("hides archived chats even when their repo matches a specific repo filter", () => {
    const archived = makeChat({ id: "a", repo: "octocat/hello", archived: true })
    expect(isChatVisibleForFilter(archived, "octocat/hello")).toBe(false)
  })

  it("matches the No-repository filter to NEW_REPOSITORY chats only", () => {
    const noRepo = makeChat({ id: "a", repo: NEW_REPOSITORY })
    const withRepo = makeChat({ id: "b", repo: "octocat/hello" })
    expect(isChatVisibleForFilter(noRepo, NO_REPOSITORY)).toBe(true)
    expect(isChatVisibleForFilter(withRepo, NO_REPOSITORY)).toBe(false)
  })

  it("hides empty chats unless they were branched (have a parent)", () => {
    const emptyRoot = makeChat({ id: "a", messages: [], messageCount: 0 })
    const emptyBranch = makeChat({ id: "b", messages: [], messageCount: 0, parentChatId: "a" })
    expect(isChatVisibleForFilter(emptyRoot, ALL_REPOSITORIES)).toBe(false)
    expect(isChatVisibleForFilter(emptyBranch, ALL_REPOSITORIES)).toBe(true)
  })
})

describe("buildTreeOrderedChatIds", () => {
  // The bug this guards against: archived chats were reachable via Alt+Up/Down
  // even while the sidebar only showed active chats.
  it("never yields an archived chat under the Active-chats filter", () => {
    const chats = [
      makeChat({ id: "active-1", lastActiveAt: 3 }),
      makeChat({ id: "archived-1", archived: true, lastActiveAt: 2 }),
      makeChat({ id: "active-2", lastActiveAt: 1 }),
    ]
    expect(buildTreeOrderedChatIds(chats, ALL_REPOSITORIES)).toEqual(["active-1", "active-2"])
  })

  // The invariant that makes the whole bug-class impossible: what you can
  // navigate to is EXACTLY what the sidebar shows. Both derive from
  // isChatVisibleForFilter, so this asserts they can never drift.
  it("navigable ids equal the isChatVisibleForFilter set for every filter", () => {
    const chats = [
      makeChat({ id: "own-active", repo: "octocat/hello", lastActiveAt: 5 }),
      makeChat({ id: "own-archived", repo: "octocat/hello", archived: true, lastActiveAt: 4 }),
      makeChat({ id: "other-repo", repo: "acme/widgets", lastActiveAt: 3 }),
      makeChat({ id: "no-repo", repo: NEW_REPOSITORY, lastActiveAt: 2 }),
      makeChat({ id: "empty-root", messages: [], messageCount: 0, lastActiveAt: 1 }),
    ]
    const filters = [ALL_REPOSITORIES, ARCHIVED_CHATS, NO_REPOSITORY, "octocat/hello", "acme/widgets"]
    for (const filter of filters) {
      const navigable = new Set(buildTreeOrderedChatIds(chats, filter))
      const visible = new Set(chats.filter((c) => isChatVisibleForFilter(c, filter)).map((c) => c.id))
      expect(navigable).toEqual(visible)
    }
  })
})

// When the open chat is archived it leaves the active view, so selection must
// move to a still-visible neighbor. This is the pure core of setChatArchived:
// resolve the neighbor from the pre-archive tree order (the chat is still
// visible at that instant), then the archive hides it.
describe("selection after archiving the open chat", () => {
  const active = [
    makeChat({ id: "a", lastActiveAt: 3 }),
    makeChat({ id: "b", lastActiveAt: 2 }),
    makeChat({ id: "c", lastActiveAt: 1 }),
  ]
  const order = () => buildTreeOrderedChatIds(active, ALL_REPOSITORIES) // ["a","b","c"]

  it("selects the following chat when a middle chat is archived", () => {
    expect(getNextChatIdAfterDeletion(order(), ["b"])).toBe("c")
  })

  it("selects the previous chat when the last chat is archived", () => {
    expect(getNextChatIdAfterDeletion(order(), ["c"])).toBe("b")
  })

  it("always resolves to a still-visible chat", () => {
    const next = getNextChatIdAfterDeletion(order(), ["a"])
    expect(next).not.toBeNull()
    const nextChat = active.find((c) => c.id === next)!
    expect(isChatVisibleForFilter(nextChat, ALL_REPOSITORIES)).toBe(true)
  })

  it("resolves to null (empty state) when the only visible chat is archived", () => {
    const solo = [makeChat({ id: "only" })]
    const soloOrder = buildTreeOrderedChatIds(solo, ALL_REPOSITORIES)
    expect(getNextChatIdAfterDeletion(soloOrder, ["only"])).toBeNull()
  })
})

describe("getChatIdForRepoFilter", () => {
  it("keeps the current chat when it is still visible under the new filter", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 2 }),
      makeChat({ id: "b", repo: "octocat/hello", lastActiveAt: 1 }),
    ]
    // Selecting the same repo the current chat belongs to keeps it selected.
    expect(getChatIdForRepoFilter(chats, "octocat/hello", "b")).toBe("b")
  })

  it("selects the first visible chat when the current chat is filtered out", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 2 }),
      makeChat({ id: "b", repo: "octocat/other", lastActiveAt: 1 }),
    ]
    // Current chat "a" belongs to a different repo than the selected filter, so
    // we land on the first (most recent) chat in the filtered list.
    expect(getChatIdForRepoFilter(chats, "octocat/other", "a")).toBe("b")
  })

  it("selects the first visible chat when nothing is currently selected", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 1 }),
      makeChat({ id: "b", repo: "octocat/hello", lastActiveAt: 2 }),
    ]
    expect(getChatIdForRepoFilter(chats, "octocat/hello", null)).toBe("b")
  })

  it("returns null when the filter matches no chats", () => {
    const chats = [makeChat({ id: "a", repo: "octocat/hello" })]
    expect(getChatIdForRepoFilter(chats, "octocat/nonexistent", "a")).toBeNull()
  })
})

/**
 * A workspace is a boundary, not a label: opening Marketing Automation should
 * leave you looking at that team's work and nothing else. The scoping lives in
 * the same predicate as every other visibility rule so the sidebar and
 * Alt+Up/Down can never disagree about what exists.
 */
describe("workspace scoping", () => {
  const inWs = makeChat({ id: "in", workspaceId: "ws-marketing" })
  const otherWs = makeChat({ id: "other", workspaceId: "ws-support" })
  const unbound = makeChat({ id: "unbound", workspaceId: null })

  it("shows every chat when no workspace is open", () => {
    for (const c of [inWs, otherWs, unbound]) {
      expect(isChatVisibleForFilter(c, ALL_REPOSITORIES, null)).toBe(true)
    }
  })

  it("shows only the open workspace's chats", () => {
    expect(isChatVisibleForFilter(inWs, ALL_REPOSITORIES, "ws-marketing")).toBe(true)
    expect(isChatVisibleForFilter(otherWs, ALL_REPOSITORIES, "ws-marketing")).toBe(false)
  })

  it("hides chats belonging to no workspace while one is open", () => {
    // Chats from before workspaces existed, and any the binding bug left
    // unbound. They are still reachable under "All workspaces".
    expect(isChatVisibleForFilter(unbound, ALL_REPOSITORIES, "ws-marketing")).toBe(false)
    expect(isChatVisibleForFilter(unbound, ALL_REPOSITORIES, null)).toBe(true)
  })

  it("scopes the archived view to the open workspace too", () => {
    const archivedHere = makeChat({ id: "ah", workspaceId: "ws-marketing", archived: true })
    const archivedElsewhere = makeChat({ id: "ae", workspaceId: "ws-support", archived: true })
    expect(isChatVisibleForFilter(archivedHere, ARCHIVED_CHATS, "ws-marketing")).toBe(true)
    expect(isChatVisibleForFilter(archivedElsewhere, ARCHIVED_CHATS, "ws-marketing")).toBe(false)
  })

  it("still applies the repo filter inside a workspace", () => {
    const wrongRepo = makeChat({ id: "wr", workspaceId: "ws-marketing", repo: "octocat/other" })
    expect(isChatVisibleForFilter(wrongRepo, "octocat/hello", "ws-marketing")).toBe(false)
  })

  it("keeps keyboard navigation to the open workspace", () => {
    // The bug this prevents: Alt+Down walking into another team's chat that the
    // sidebar is not showing.
    const ids = buildTreeOrderedChatIds([inWs, otherWs, unbound], ALL_REPOSITORIES, "ws-marketing")
    expect(ids).toEqual(["in"])
  })

  it("defaults to unscoped so existing callers are unaffected", () => {
    expect(isChatVisibleForFilter(otherWs, ALL_REPOSITORIES)).toBe(true)
    expect(buildTreeOrderedChatIds([inWs, otherWs], ALL_REPOSITORIES)).toHaveLength(2)
  })
})
