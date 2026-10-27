import { prisma } from "@/lib/db/prisma"

/**
 * Which of these chats every member of the workspace may read.
 *
 * Two kinds are: a chat its owner shared to the workspace, and a chat a
 * scheduled run produced. A run's chat is the record of what a shared job did,
 * and the run's error text is already shown to every member, so hiding the
 * transcript behind the job author would only hide the explanation.
 *
 * Everything else is private to its owner, and the feed must not even link to
 * it — a link to a page you cannot open still says the page exists.
 */
export async function workspaceVisibleChatIds(
  workspaceId: string,
  chatIds: (string | null | undefined)[]
): Promise<Set<string>> {
  const ids = [...new Set(chatIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return new Set()
  const rows = await prisma.chat.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      OR: [{ sharedToWorkspaceAt: { not: null } }, { scheduledJobRun: { isNot: null } }],
    },
    select: { id: true },
  })
  return new Set(rows.map((r) => r.id))
}
