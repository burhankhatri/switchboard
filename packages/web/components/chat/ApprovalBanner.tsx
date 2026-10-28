"use client"

import { ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useChatApprovalsQuery, useDecideApprovalMutation } from "@/lib/query/hooks/useChatApprovalsQuery"

function describe(a: { action: string; count: number | null; campaign: string | null }): string {
  let text = a.action
  if (a.count != null) text += `: ${a.count}`
  if (a.campaign) text += `${a.count != null ? "," : ":"} campaign ${a.campaign}`
  return text
}

/**
 * The click that lets a write happen. Sits above the composer while the agent
 * has asked and nobody has answered; after Approve it says what to do next,
 * because the approval only reaches the agent with the next message.
 */
export function ApprovalBanner({ chatId, isMobile = false }: { chatId: string; isMobile?: boolean }) {
  const { data } = useChatApprovalsQuery(chatId)
  const decide = useDecideApprovalMutation(chatId)
  const items = data ?? []
  if (items.length === 0) return null

  return (
    <div className={cn("space-y-1.5", isMobile ? "mx-2 mb-2" : "mx-1 mb-2")} data-testid="approval-banner">
      {items.map((a) => (
        <div
          key={a.id}
          className={cn(
            "flex items-start gap-2 rounded-chip border border-amber-500/40 bg-amber-500/10 px-3 py-2",
            isMobile ? "text-sm" : "text-xs"
          )}
        >
          <ShieldCheck className={cn("mt-0.5 shrink-0 text-amber-700 dark:text-amber-300", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">
              {a.status === "pending" ? "The agent asks to " : "Approved: "}
              {describe(a)}
            </div>
            <div className="text-muted-foreground">
              {a.status === "pending"
                ? "Nothing is written until you approve. The agent has stopped."
                : "Send your next message (e.g. \"go ahead\") and the agent will carry this approval."}
            </div>
          </div>
          {a.status === "pending" && (
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: a.id, decision: "approve" })}
                className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: a.id, decision: "decline" })}
                className="rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-accent disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
