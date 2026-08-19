"use client"

import { MessageSquare, Plug, Plus, Users } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useWorkspaceOverview } from "@/lib/query/hooks/useWorkspaceOverview"
import { WorkspaceLauncher } from "@/components/workspaces/WorkspaceLauncher"
import { isChatVisibleForFilter } from "@/lib/chat-tree"
import { ALL_REPOSITORIES } from "@/lib/contexts"
import type { Chat } from "@/lib/types"
import { cn } from "@/lib/utils"

interface HomeViewProps {
  isMobile: boolean
  chats: Chat[]
  onSelectChat: (chatId: string) => void | Promise<void>
  onNewChat: () => void | Promise<void>
}

/** "3 days ago" is more useful here than a timestamp nobody reads. */
function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days}d ago`
}

/**
 * Where "/" lands.
 *
 * The app used to open straight into an empty composer, so being added to a
 * workspace told you nothing about what you had been given. The whole promise
 * is that someone joins and it already works — that only reads if the first
 * screen says what this workspace reaches and what the team has been asking it.
 *
 * Everything here is already loaded for the sidebar, so it costs no extra
 * request: the overview is the same cache entry the Connections panel reads.
 */
export function HomeView({ isMobile, chats, onSelectChat, onNewChat }: HomeViewProps) {
  const { activeWorkspace: active, ready } = useWorkspace()
  const { data: overview } = useWorkspaceOverview(active?.id)

  if (!ready) return null

  // No workspace open: the workspaces themselves are the home page. Picking
  // where the work runs comes before composing anything.
  if (!active) {
    return (
      <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
        <WorkspaceLauncher />
      </div>
    )
  }

  const connections = overview?.connections ?? []
  const members = overview?.members ?? []
  const recent = chats
    .filter((c) => isChatVisibleForFilter(c, ALL_REPOSITORIES, active.id))
    .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))
    .slice(0, 6)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-[52rem]", isMobile ? "p-4 pb-safe" : "px-6 py-10")}>
        <header>
          <h1 className={cn("font-display tracking-tight", isMobile ? "text-2xl" : "text-3xl")}>
            {active.name}
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Its skills, scripts and connections load on every run. Ask for the task —
            there is nothing to set up.
          </p>
        </header>

        <button
          onClick={() => void onNewChat()}
          className={cn(
            "mt-6 flex w-full items-center gap-2.5 rounded-xl border border-line px-4 py-3",
            "bg-surface text-left text-sm text-ink-2 shadow-hairline",
            "hover:border-line-strong hover:text-ink cursor-pointer transition-colors"
          )}
        >
          <Plus className="h-4 w-4 shrink-0" />
          Start a new chat in {active.name}
        </button>

        {connections.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Connected</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-line bg-surface p-3 shadow-hairline"
                >
                  <div className="flex items-center gap-1.5">
                    <Plug className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">
                    {c.description ?? c.baseUrl ?? (c.kind === "mcp" ? "MCP server" : "REST API")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Recent chats</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">
              Nothing yet. Whatever you ask runs with everything above already wired in.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hairline">
              {recent.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => void onSelectChat(c.id)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {c.displayName || "Untitled"}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
                      {ago(c.lastActiveAt ?? c.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {members.length > 0 && (
          <section className="mt-8 flex items-center gap-2 text-[12px] text-ink-3">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>
              {members.length === 1
                ? "Just you so far — add teammates by GitHub username."
                : `${members.length} people share this workspace.`}
            </span>
          </section>
        )}
      </div>
    </div>
  )
}
