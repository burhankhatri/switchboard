/**
 * Local-first storage for workspace files.
 *
 * Two separate things live here and they must not be confused:
 *
 * - **cache**  — the last content the server gave us. Disposable. It exists so
 *   opening a file you have opened before paints immediately instead of waiting
 *   on a GitHub round trip; the real value is fetched straight after and
 *   overwrites it.
 * - **draft**  — edits the user made that are NOT yet committed. NOT disposable.
 *   It is written on every keystroke so a refresh, a crash or a closed tab never
 *   costs someone their work, and it is cleared only once the commit succeeds.
 *
 * Everything is best-effort: localStorage throws in private mode and when the
 * quota is full, and a file editor must not break because a cache write failed.
 */

const CACHE_PREFIX = "sw:file:"
const DRAFT_PREFIX = "sw:draft:"

/**
 * Per-entry cap. localStorage is a ~5MB budget shared with everything else on
 * the origin, so one large file must not be able to evict every other entry.
 * Files above this simply are not cached — they still open, just not instantly.
 */
const MAX_ENTRY_BYTES = 128 * 1024

export interface CachedFile {
  content: string
  sha: string
  truncated: boolean
}

function key(prefix: string, workspaceId: string, path: string): string {
  return `${prefix}${workspaceId}:${path}`
}

function read<T>(storageKey: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(storageKey: string, value: unknown): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled. Drop the cheapest entries and retry
    // once — if it still fails, carry on without persistence rather than
    // surfacing a storage problem as an editor problem.
    try {
      evictCache()
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* give up silently */
    }
  }
}

function remove(storageKey: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    /* ignore */
  }
}

/**
 * Drop every cached file. Only the disposable half — drafts are never evicted,
 * because losing one loses work the user did.
 */
function evictCache(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k?.startsWith(CACHE_PREFIX)) doomed.push(k)
    }
    doomed.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

export function readCachedFile(workspaceId: string, path: string): CachedFile | null {
  return read<CachedFile>(key(CACHE_PREFIX, workspaceId, path))
}

export function writeCachedFile(workspaceId: string, path: string, file: CachedFile): void {
  if (file.content.length > MAX_ENTRY_BYTES) return
  write(key(CACHE_PREFIX, workspaceId, path), file)
}

export interface Draft {
  content: string
  /** The sha the draft was started from, so a stale draft can be detected. */
  baseSha: string
}

export function readDraft(workspaceId: string, path: string): Draft | null {
  return read<Draft>(key(DRAFT_PREFIX, workspaceId, path))
}

export function writeDraft(workspaceId: string, path: string, draft: Draft): void {
  write(key(DRAFT_PREFIX, workspaceId, path), draft)
}

export function clearDraft(workspaceId: string, path: string): void {
  remove(key(DRAFT_PREFIX, workspaceId, path))
}

/** True when a draft exists and differs from the last cached server copy. */
export function isWorkspaceFileDirty(workspaceId: string, path: string): boolean {
  const draft = readDraft(workspaceId, path)
  if (!draft) return false
  const cached = readCachedFile(workspaceId, path)
  if (!cached) return true
  return draft.content !== cached.content
}
