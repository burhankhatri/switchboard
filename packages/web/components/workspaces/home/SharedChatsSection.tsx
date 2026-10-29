"use client"

import { HomeAiPrompt } from "./HomeAi"
import { MessageSquare } from "lucide-react"
import type { SharedChat } from "@/lib/workspace-home/home"
import { ago } from "./time"

export function SharedChatsSection({
  chats,
  onOpenColleagueChat,
  onOpenOwnChat,
}: {
  chats: SharedChat[]
  onOpenColleagueChat: (chatId: string) => void
  onOpenOwnChat: (chatId: string) => void | Promise<void>
}) {
  if (chats.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Shared with the workspace</h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hairline">
        {chats.map((c) => (
          <li key={c.id} className="flex items-center">
            <button
              // Your own chat opens where you can keep working in it; someone
              // else's opens read-only.
              onClick={() => (c.isYours ? void onOpenOwnChat(c.id) : onOpenColleagueChat(c.id))}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.title}</span>
              <span className="shrink-0 text-[11px] text-ink-3">
                {c.isYours ? "you" : (c.owner.name ?? "a member")} · {ago(c.sharedAt)}
              </span>
            </button>
            <HomeAiPrompt label="Edit chat summary on home" prompt={`Create or update a concise home component summarising conversation ${c.id}. Highlight its decisions and unresolved issues. Do not change the original messages.`} />
          </li>
        ))}
      </ul>
    </section>
  )
}
