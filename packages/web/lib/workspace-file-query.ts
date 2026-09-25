import type { CachedFile } from "@/lib/workspace-file-cache"

export interface FilePayload {
  path: string
  content: string
  truncated: boolean
  sha: string
}

/** Past this age a file is refetched when opened; within it the copy is used as is. */
export const FILE_STALE_MS = 30 * 1000

/**
 * Query options for one open workspace file, seeded from the localStorage copy.
 *
 * The seed is stamped with when that copy was fetched, not when it was read.
 * Stamping it "now" made a copy of any age look fresh, and because the app
 * turns off refetch-on-focus, a file changed on GitHub stayed stale in the
 * editor for as long as it was open, and again after every reload. A copy
 * inside FILE_STALE_MS still opens with no network call; an older one paints
 * at once and revalidates behind it.
 */
export function workspaceFileQueryOptions({
  wsId,
  path,
  cached,
  fetchFile,
}: {
  wsId: string
  path: string | null
  cached: CachedFile | null
  fetchFile: () => Promise<FilePayload>
}) {
  return {
    queryKey: ["workspace-file", wsId, path] as const,
    queryFn: fetchFile,
    enabled: !!wsId && !!path,
    retry: false,
    initialData:
      cached && path
        ? { path, content: cached.content, sha: cached.sha, truncated: cached.truncated }
        : undefined,
    initialDataUpdatedAt: cached ? (cached.fetchedAt ?? 0) : undefined,
    staleTime: FILE_STALE_MS,
  }
}
