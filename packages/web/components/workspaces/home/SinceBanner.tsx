"use client"

import type { WorkspaceHome } from "@/lib/workspace-home/home"
import { describeCounts } from "@/lib/workspace-home/since"
import { FeedItem } from "./ActivityFeed"

function sinceLabel(from: string, firstVisit: boolean): string {
  if (firstVisit) return "In the last week"
  const date = new Date(from)
  const days = (Date.now() - date.getTime()) / 86_400_000
  // A weekday reads naturally for the past week; beyond that it is ambiguous.
  const when =
    days < 1
      ? "earlier today"
      : days < 7
        ? date.toLocaleDateString(undefined, { weekday: "long" })
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `Since ${when}`
}

/** Hidden entirely when nothing happened — an empty summary is just noise. */
export function SinceBanner({
  since,
  onOpenChat,
}: {
  since: NonNullable<WorkspaceHome["since"]>
  onOpenChat: (chatId: string) => void
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-primary/30 bg-accent-tint">
      <p className="px-4 pt-3 text-[13px] text-accent-ink">
        <span className="font-medium">{sinceLabel(since.from, since.firstVisit)}:</span>{" "}
        {describeCounts(since.counts)}
      </p>
      {since.highlights.length > 0 && (
        <ul className="mt-2 divide-y divide-line border-t border-primary/20 bg-surface">
          {since.highlights.map((e) => (
            <li key={e.id}>
              <FeedItem event={e} onOpenChat={onOpenChat} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
