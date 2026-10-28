import type { Prisma } from "@prisma/client"

/**
 * The mechanical half of "only when the user asks in that turn".
 *
 * The rule used to be prose repeated in five skills, and it drifted (LEARNINGS
 * 29: two copies disagreed and an approved enrichment did nothing). Now the
 * agent asks through `request_approval`, a person clicks, and the scripts that
 * write refuse unless SWITCHBOARD_APPROVAL is in their environment. The
 * variable exists only when an approved row is waiting on this chat, and the
 * turn that receives it spends it.
 */
export interface ApprovalClient {
  chatApproval: {
    findFirst: (args: Prisma.ChatApprovalFindFirstArgs) => Promise<{ id: string } | null>
    update: (args: Prisma.ChatApprovalUpdateArgs) => Promise<unknown>
  }
}

export const APPROVAL_ENV = "SWITCHBOARD_APPROVAL"

/** The oldest approved, unspent approval for this chat, marked used on the way out. */
export async function consumeApprovalEnv(
  prisma: ApprovalClient,
  chatId: string
): Promise<Record<string, string>> {
  const approved = await prisma.chatApproval.findFirst({
    where: { chatId, status: "approved" },
    orderBy: { decidedAt: "asc" },
    select: { id: true },
  })
  if (!approved) return {}
  await prisma.chatApproval.update({
    where: { id: approved.id },
    data: { status: "used", usedAt: new Date() },
  })
  return { [APPROVAL_ENV]: approved.id }
}

/** One line a person can approve or decline without opening the chat. */
export function describeApproval(a: {
  action: string
  count: number | null | undefined
  campaign: string | null | undefined
}): string {
  let text = a.action
  if (a.count != null) text += `: ${a.count}`
  if (a.campaign) text += `${a.count != null ? "," : ":"} campaign ${a.campaign}`
  return text
}
