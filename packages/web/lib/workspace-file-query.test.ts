import { describe, it, expect, vi, afterEach } from "vitest"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { workspaceFileQueryOptions, type FilePayload } from "@/lib/workspace-file-query"
import type { CachedFile } from "@/lib/workspace-file-cache"

/**
 * The editor seeds its query from a localStorage copy of the file. That copy
 * used to be stamped as fetched "now" whenever it was read, so a copy of any
 * age counted as fresh: opening the file skipped the server, and with
 * refetchOnWindowFocus off app-wide nothing asked again while it stayed open.
 * A skill rewritten on GitHub kept showing its old stub in the editor while
 * the skills list (not seeded from the cache) showed the new version.
 *
 * These drive the real query-core observer — what useQuery wraps — with the
 * app's defaults, so they test the options as React would use them.
 */

const WS = "ws1"
const PATH = "workspaces/gtm-lead-engine/.claude/skills/livenergy-dna/SKILL.md"
const NOW = 1_790_000_000_000

function client() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
  })
}

function cachedAt(fetchedAt: number | undefined): CachedFile {
  return { content: "old stub", sha: "old", truncated: false, ...(fetchedAt === undefined ? {} : { fetchedAt }) }
}

function observe(cached: CachedFile | null) {
  const server: FilePayload = { path: PATH, content: "new skill", sha: "new", truncated: false }
  const fetchFile = vi.fn(async () => server)
  const observer = new QueryObserver(client(), workspaceFileQueryOptions({ wsId: WS, path: PATH, cached, fetchFile }))
  const unsubscribe = observer.subscribe(() => {})
  return { observer, fetchFile, unsubscribe }
}

describe("workspace file query", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("revalidates a cached copy older than staleTime, while still painting it first", async () => {
    vi.useFakeTimers({ now: NOW })
    const { observer, fetchFile, unsubscribe } = observe(cachedAt(NOW - 10 * 60_000))

    // Instant paint from the cache, not a loading state.
    expect(observer.getCurrentResult().data?.content).toBe("old stub")
    expect(observer.getCurrentResult().isPending).toBe(false)

    await vi.runAllTimersAsync()
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data?.content).toBe("new skill")
    unsubscribe()
  })

  it("skips the network for a copy fetched within staleTime", async () => {
    vi.useFakeTimers({ now: NOW })
    const { observer, fetchFile, unsubscribe } = observe(cachedAt(NOW - 5_000))
    await vi.runAllTimersAsync()
    expect(fetchFile).not.toHaveBeenCalled()
    expect(observer.getCurrentResult().data?.content).toBe("old stub")
    unsubscribe()
  })

  it("treats a cache entry with no fetch time (written before this fix) as stale", async () => {
    vi.useFakeTimers({ now: NOW })
    const { fetchFile, unsubscribe } = observe(cachedAt(undefined))
    await vi.runAllTimersAsync()
    expect(fetchFile).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("fetches when nothing is cached", async () => {
    vi.useFakeTimers({ now: NOW })
    const { observer, fetchFile, unsubscribe } = observe(null)
    expect(observer.getCurrentResult().isPending).toBe(true)
    await vi.runAllTimersAsync()
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data?.content).toBe("new skill")
    unsubscribe()
  })
})
