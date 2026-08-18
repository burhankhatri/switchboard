"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Cloud, Database, EmptyPage, Globe, Page } from "iconoir-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { cn } from "@/lib/utils"

interface Connection {
  id: string
  kind: string
  name: string
  slug: string
  description: string | null
  baseUrl: string | null
  mcpUrl: string | null
}

interface RepoFile {
  path: string
  name: string
}

/** Exactly what GET /api/workspaces/:id/files returns, and what WorkspaceFiles caches. */
interface WorkspaceFilesResponse {
  workspace: RepoFile[]
  shared: RepoFile[]
}

/**
 * The trailing `@word` the caret is currently inside, if any.
 *
 * Anchored to a word boundary so an email address, a decorator, or an `@` in
 * the middle of a sentence does not open the menu. Returns the offset of the
 * `@` itself so a selection can replace exactly the token that was typed.
 */
export function parseMention(input: string): { query: string; start: number } | null {
  const match = /(^|\s)@([\w.-]*)$/.exec(input)
  if (!match) return null
  return { query: match[2], start: match.index + match[1].length }
}

export interface MentionItem {
  key: string
  /** What gets inserted, after the `@`. */
  token: string
  label: string
  detail: string
  icon: React.ReactNode
}

/**
 * The `@` menu.
 *
 * Lists what this workspace actually has — its REST and MCP connections, and
 * its files — rather than a fixed catalogue of third-party services. A
 * workspace is the unit that owns credentials and skills here, so those are the
 * only things worth referring to by name in a prompt.
 *
 * Mentioning a connection inserts its slug. The agent already receives a
 * description of every connection in its environment, so the slug is enough for
 * it to resolve; this menu exists so the author does not have to remember them.
 */
export function useMentionItems(query: string): MentionItem[] {
  const { activeWorkspace } = useWorkspace()
  const wsId = activeWorkspace?.id

  const { data: connections } = useQuery({
    queryKey: ["workspace-connections", wsId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsId}/connections`)
      if (!r.ok) throw new Error(String(r.status))
      return ((await r.json()) as { connections: Connection[] }).connections
    },
    enabled: !!wsId,
    staleTime: 60_000,
    retry: false,
  })

  // Shares the ["workspace-files", id] key with WorkspaceFiles, so the tree is
  // fetched once for both. That means the shape stored under the key has to be
  // the SAME shape WorkspaceFiles stores — a key is a cache slot, and two
  // queryFns returning different shapes into one slot means whichever resolves
  // first decides what the other one reads. `select` narrows for this consumer
  // without changing what is cached.
  const { data: files } = useQuery({
    queryKey: ["workspace-files", wsId],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsId}/files`)
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as WorkspaceFilesResponse
    },
    select: (d) => d.workspace,
    enabled: !!wsId,
    staleTime: 60_000,
    retry: false,
  })

  return useMemo(() => {
    const q = query.toLowerCase()
    const items: MentionItem[] = []

    for (const c of Array.isArray(connections) ? connections : []) {
      const isMcp = c.kind === "mcp"
      items.push({
        key: `conn:${c.id}`,
        token: c.slug,
        label: c.name,
        detail: c.description ?? (isMcp ? c.mcpUrl ?? "MCP server" : c.baseUrl ?? "REST API"),
        icon: isMcp ? <Cloud width={15} height={15} /> : <Globe width={15} height={15} />,
      })
    }

    for (const f of Array.isArray(files) ? files : []) {
      items.push({
        key: `file:${f.path}`,
        token: f.name,
        label: f.name,
        detail: "file in this workspace",
        icon: f.name.endsWith(".csv") ? (
          <Database width={15} height={15} />
        ) : f.name.endsWith(".yaml") || f.name.endsWith(".yml") ? (
          <Page width={15} height={15} />
        ) : (
          <EmptyPage width={15} height={15} />
        ),
      })
    }

    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.token.toLowerCase().includes(q)
    )
  }, [connections, files, query])
}

interface MentionMenuProps {
  items: MentionItem[]
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onSelect: (item: MentionItem) => void
  query: string
}

export function MentionMenu({
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  query,
}: MentionMenuProps) {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  const [engaged, setEngaged] = useState(false)

  // One highlight that glides between rows, rather than each row toggling its
  // own background — the movement is what makes keyboard navigation legible.
  useLayoutEffect(() => {
    const target = rowRefs.current[activeIndex]
    if (target) setBox({ top: target.offsetTop, height: target.offsetHeight })
  }, [activeIndex, items.length])

  useEffect(() => {
    setEngaged(false)
  }, [query])

  return (
    <div
      onMouseLeave={() => setEngaged(false)}
      className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-[10px] bg-surface p-1 shadow-raised"
      style={{ animation: "pop-in 180ms var(--ease-spring) both", transformOrigin: "bottom center" }}
      role="listbox"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && engaged && items.length > 0 ? 1 : 0,
          transition:
            "top 220ms var(--ease-spring), height 220ms var(--ease-spring), opacity 150ms ease",
        }}
      />

      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          ref={(el) => {
            rowRefs.current[i] = el
          }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => {
            onActiveIndexChange(i)
            setEngaged(true)
          }}
          onClick={() => onSelect(item)}
          className={cn(
            "relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left",
            "cursor-pointer"
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
            {item.icon}
          </span>
          <span className="shrink-0 text-[12.5px] font-medium text-ink">{item.label}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{item.detail}</span>
        </button>
      ))}

      {items.length === 0 && (
        <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">
          {query ? `No connection or file matching “${query}”` : "This workspace has nothing to mention yet"}
        </div>
      )}

      <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
        Connections and files in this workspace
      </div>
    </div>
  )
}
