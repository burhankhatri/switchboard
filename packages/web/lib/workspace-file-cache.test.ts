import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  readCachedFile,
  writeCachedFile,
  readDraft,
  writeDraft,
  clearDraft,
} from "@/lib/workspace-file-cache"

/**
 * The module talks to `window.localStorage` and bails out when there is no
 * window, so the tests need both to exist. This is a deliberately dumb
 * in-memory stand-in rather than a mock of the module under test.
 */
function installStorage() {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  vi.stubGlobal("window", { localStorage: storage })
  return store
}

const WS = "ws1"
const PATH = "workspaces/lead-gen/SKILL.md"

describe("workspace file cache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("round-trips a cached file", () => {
    installStorage()
    writeCachedFile(WS, PATH, { content: "hello", sha: "abc", truncated: false })
    expect(readCachedFile(WS, PATH)).toEqual({
      content: "hello",
      sha: "abc",
      truncated: false,
    })
  })

  it("keys by workspace, so two workspaces cannot read each other's copy", () => {
    installStorage()
    writeCachedFile(WS, PATH, { content: "ours", sha: "a", truncated: false })
    expect(readCachedFile("other-ws", PATH)).toBeNull()
  })

  it("skips caching a file above the entry cap", () => {
    installStorage()
    const huge = "x".repeat(128 * 1024 + 1)
    writeCachedFile(WS, PATH, { content: huge, sha: "a", truncated: false })
    // Not cached is correct: the file still opens, just not instantly. One
    // oversized entry must not be able to evict everything else.
    expect(readCachedFile(WS, PATH)).toBeNull()
  })

  it("round-trips a draft and clears it on demand", () => {
    installStorage()
    writeDraft(WS, PATH, { content: "half-written", baseSha: "abc" })
    expect(readDraft(WS, PATH)).toEqual({ content: "half-written", baseSha: "abc" })
    clearDraft(WS, PATH)
    expect(readDraft(WS, PATH)).toBeNull()
  })

  it("evicts cached files under quota pressure but never drafts", () => {
    installStorage()
    writeDraft(WS, PATH, { content: "precious", baseSha: "abc" })
    writeCachedFile(WS, "a.txt", { content: "a", sha: "1", truncated: false })
    writeCachedFile(WS, "b.txt", { content: "b", sha: "2", truncated: false })

    // Fail exactly one write, which is what sends `write` down its evict-then-
    // retry path.
    const storage = (globalThis as { window?: { localStorage: Storage } }).window!.localStorage
    const realSet = storage.setItem.bind(storage)
    let failuresLeft = 1
    storage.setItem = (k: string, v: string) => {
      if (failuresLeft-- > 0) throw new Error("QuotaExceededError")
      realSet(k, v)
    }

    writeCachedFile(WS, "c.txt", { content: "c", sha: "3", truncated: false })

    // The disposable half is gone, the retry succeeded, and the unsaved work
    // survived — that last one is the whole point of keeping them separate.
    expect(readCachedFile(WS, "a.txt")).toBeNull()
    expect(readCachedFile(WS, "b.txt")).toBeNull()
    expect(readCachedFile(WS, "c.txt")?.content).toBe("c")
    expect(readDraft(WS, PATH)).toEqual({ content: "precious", baseSha: "abc" })
  })

  it("degrades to a no-op rather than throwing when storage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        length: 0,
        key: () => null,
        getItem: () => {
          throw new Error("SecurityError")
        },
        setItem: () => {
          throw new Error("SecurityError")
        },
        removeItem: () => {
          throw new Error("SecurityError")
        },
        clear: () => {},
      } as unknown as Storage,
    })
    // Private-mode Safari throws on access. An editor must not break because a
    // cache write failed.
    expect(() =>
      writeCachedFile(WS, PATH, { content: "x", sha: "a", truncated: false })
    ).not.toThrow()
    expect(readCachedFile(WS, PATH)).toBeNull()
    expect(() => clearDraft(WS, PATH)).not.toThrow()
  })
})
