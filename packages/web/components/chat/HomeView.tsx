"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { useWorkspaceOverview } from "@/lib/query/hooks/useWorkspaceOverview"
import { WorkspaceLauncher } from "@/components/workspaces/WorkspaceLauncher"
import { ConnectedSection } from "@/components/workspaces/home/ConnectedSection"
import { RecentChatsSection } from "@/components/workspaces/home/RecentChatsSection"
import { SinceBanner } from "@/components/workspaces/home/SinceBanner"
import { JobsSection } from "@/components/workspaces/home/JobsSection"
import { ActivityFeed } from "@/components/workspaces/home/ActivityFeed"
import { SharedChatsSection } from "@/components/workspaces/home/SharedChatsSection"
import { WidgetGrid } from "@/components/workspaces/home/widgets/WidgetGrid"
import { ColleagueChatDialog } from "@/components/workspaces/home/ColleagueChatDialog"
import { useWorkspaceHome } from "@/lib/query/hooks/useWorkspaceHome"
import { isChatVisibleForFilter } from "@/lib/chat-tree"
import { ALL_REPOSITORIES } from "@/lib/contexts"
import type { Chat } from "@/lib/types"
import { cn } from "@/lib/utils"

interface HomeViewProps {
  isMobile: boolean
  chats: Chat[]
  onSelectChat: (chatId: string) => void | Promise<void>
  onNewChat: () => unknown
  /** Start a chat with `prompt` waiting in the composer, unsent. */
  onNewChatWithPrompt: (prompt: string) => void | Promise<void>
  /** Open one of your own jobs in the scheduled agents view. */
  onManageJob: (jobId: string, jobName: string) => void | Promise<void>
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
export function HomeView({
  isMobile,
  chats,
  onSelectChat,
  onNewChat,
  onNewChatWithPrompt,
  onManageJob,
}: HomeViewProps) {
  const { activeWorkspace: active, setActiveWorkspace: setActive, ready, requestOpenFile } = useWorkspace()
  const { data: overview } = useWorkspaceOverview(active?.id)
  const { data: home } = useWorkspaceHome(active?.id)
  const [readingChat, setReadingChat] = useState<string | null>(null)

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
      <div className={cn("mx-auto w-full max-w-[60rem]", isMobile ? "p-4 pb-safe" : "px-8 py-10")}>
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className={cn("font-display tracking-tight", isMobile ? "text-2xl" : "text-[34px] leading-tight")}>
              {active.name}
            </h1>
            <p className="mt-1 text-[13px] text-ink-3">
              {members.length} {members.length === 1 ? "member" : "members"}
              {connections.length > 0 &&
                ` · ${connections.length} ${connections.length === 1 ? "connection" : "connections"}`}
              {home && home.jobs.length > 0 && ` · ${home.jobs.length} scheduled`}
            </p>
          </div>
          <button
            onClick={() => void onNewChat()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground shadow-hairline hover:opacity-90 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </header>

        {home?.since && <SinceBanner since={home.since} onOpenChat={setReadingChat} />}
        {home && (
          <>
            <WidgetGrid
              workspaceId={active.id}
              widgets={home.widgets}
              jobs={home.jobs}
              onOpenChat={setReadingChat}
              onOpenFile={(path) => void requestOpenFile(path)}
              onAskAgent={(prompt) => void onNewChatWithPrompt(prompt)}
            />
            <JobsSection
              jobs={home.jobs}
              onOpenChat={setReadingChat}
              onManage={(job) => void onManageJob(job.id, job.name)}
            />
            <SharedChatsSection
              chats={home.sharedChats}
              onOpenColleagueChat={setReadingChat}
              onOpenOwnChat={onSelectChat}
            />
            <ActivityFeed workspaceId={active.id} firstPage={home.feed} onOpenChat={setReadingChat} />
          </>
        )}
        <ConnectedSection connections={connections} />
        <RecentChatsSection chats={recent} onSelectChat={onSelectChat} />
      </div>
      <ColleagueChatDialog
        workspaceId={active.id}
        chatId={readingChat}
        onClose={() => setReadingChat(null)}
      />
    </div>
  )
}
