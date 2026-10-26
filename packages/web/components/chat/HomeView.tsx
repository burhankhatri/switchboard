"use client"

import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useWorkspaceOverview } from "@/lib/query/hooks/useWorkspaceOverview"
import { WorkspaceLauncher } from "@/components/workspaces/WorkspaceLauncher"
import { StartChatCard } from "@/components/workspaces/home/StartChatCard"
import { ConnectedSection } from "@/components/workspaces/home/ConnectedSection"
import { RecentChatsSection } from "@/components/workspaces/home/RecentChatsSection"
import { MembersLine } from "@/components/workspaces/home/MembersLine"
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
  const { activeWorkspace: active, setActiveWorkspace: setActive, ready } = useWorkspace()
  const { data: overview } = useWorkspaceOverview(active?.id)

  if (!ready) return null

  // No workspace open: the workspaces themselves are the home page. Picking
  // where the work runs comes before composing anything.
  if (!active) {
    return (
      <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
        <WorkspaceLauncher onOpen={(w) => setActive(w)} />
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

        <StartChatCard workspaceName={active.name} onNewChat={onNewChat} />
        <ConnectedSection connections={connections} />
        <RecentChatsSection chats={recent} onSelectChat={onSelectChat} />
        <MembersLine count={members.length} />
      </div>
    </div>
  )
}
