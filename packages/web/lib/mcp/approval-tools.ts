import { prisma } from "@/lib/db/prisma"
import { notifyAsync } from "@/lib/db/notifications"
import { describeApproval } from "@/lib/server/approvals"
import type { RunTokenClaims } from "./run-token"
import type { ToolOutcome } from "./home-tools"

/** Unanswered requests one chat may hold; more is an agent looping. */
export const MAX_PENDING_APPROVALS = 3

export const REQUEST_APPROVAL_TOOL = {
  name: "request_approval",
  title: "Ask the user to approve a write",
  description:
    "Before any action that changes an external system (adding leads to a campaign, creating or " +
    "activating a campaign, enriching or generating leads, replying to a prospect, running a script " +
    "with --apply), call this with what you intend to do. It records the request and shows the user " +
    "an Approve button. Then STOP: end this turn after saying what you asked for. Do not retry the " +
    "write. When the user approves, their next message to you carries SWITCHBOARD_APPROVAL in the " +
    "environment, which the workspace scripts require for --apply; without it they refuse. One " +
    "approval covers one action.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "What you want to do, in the user's terms, e.g. 'add leads to campaign'. Max 200 characters.",
      },
      count: { type: "integer", description: "How many items it touches, when there is a number." },
      campaign: { type: "string", description: "The campaign's name and id, when one is involved." },
    },
    required: ["action"],
    additionalProperties: false,
  },
} as const

export async function requestApproval(
  claims: RunTokenClaims,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const action = typeof args.action === "string" ? args.action.trim() : ""
  if (!action) return { ok: false, text: "Say what you want approval for (action)." }
  if (action.length > 200) return { ok: false, text: "Keep the action under 200 characters." }
  const count = typeof args.count === "number" && Number.isFinite(args.count) ? Math.round(args.count) : null
  const campaign = typeof args.campaign === "string" && args.campaign.trim() ? args.campaign.trim().slice(0, 200) : null
  if (!claims.chatId) return { ok: false, text: "This run has no chat for a person to answer in." }

  const pending = await prisma.chatApproval.count({ where: { chatId: claims.chatId, status: "pending" } })
  if (pending >= MAX_PENDING_APPROVALS) {
    return {
      ok: false,
      text: `${pending} requests are already waiting on this chat. Stop and let the user answer them.`,
    }
  }

  const row = await prisma.chatApproval.create({
    data: { chatId: claims.chatId, userId: claims.userId, action, count, campaign, status: "pending" },
    select: { id: true },
  })
  // Parked as waiting on the person, the same way a question is: the badge and
  // the notification are what make the click happen.
  await prisma.chat.update({ where: { id: claims.chatId }, data: { awaitingInput: true } })
  notifyAsync({
    userId: claims.userId,
    kind: "approval_requested",
    title: "An agent asks for approval",
    body: describeApproval({ action, count, campaign }),
    chatId: claims.chatId,
    workspaceId: claims.workspaceId ?? undefined,
  })

  return {
    ok: true,
    text:
      `Approval requested (${row.id}): ${describeApproval({ action, count, campaign })}. ` +
      "Now stop and end this turn: tell the user what you asked for and that an Approve button is " +
      "waiting. When they approve, their next message carries SWITCHBOARD_APPROVAL for the scripts.",
  }
}
