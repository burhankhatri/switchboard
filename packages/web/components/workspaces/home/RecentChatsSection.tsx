"use client"

import { HomeAiPrompt } from "./HomeAi"
import { MessageSquare } from "lucide-react"
import type { Chat } from "@/lib/types"
import { ago } from "./time"

export function RecentChatsSection({
  chats,
  onSelectChat,
}: {
  chats: Chat[]
  onSelectChat: (chatId: string) => void | Promise<void>
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Recent chats</h2>
      {chats.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">
          Nothing yet. Whatever you ask runs with everything above already wired in.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hairline">
          {chats.map((c) => (
            <li key={c.id} className="flex items-center">
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
            <HomeAiPrompt label="Edit chat summary on home" prompt={`Create or update a concise home component summarising conversation ${c.id}. Highlight its decisions and unresolved issues. Do not change the original messages.`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
