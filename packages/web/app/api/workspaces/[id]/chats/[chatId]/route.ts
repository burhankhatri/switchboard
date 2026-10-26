import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, notFound, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { loadSanitizedChat } from "@/lib/server/shared-chat"

type Ctx = { params: Promise<{ id: string; chatId: string }> }

/**
 * GET /api/workspaces/:id/chats/:chatId — read a colleague's chat.
 *
 * A separate route rather than opening GET /api/chats/:chatId to members: the
 * owner routes stay owner-only by construction, so no route that sends a
 * message, renames, branches or deletes can come to admit a member by
 * sharing a helper with this one. Read-only, sanitized exactly as a public
 * share link is.
 *
 * Readable: a chat its owner shared to this workspace, or a chat a scheduled
 * run in this workspace produced. Anything else answers 404, not 403, so the
 * response does not confirm that a private chat exists.
 */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, chatId } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        workspaceId: id,
        OR: [{ sharedToWorkspaceAt: { not: null } }, { scheduledJobRun: { isNot: null } }],
      },
      select: {
        id: true,
        displayName: true,
        repo: true,
        parentChatId: true,
        sharedToWorkspaceAt: true,
        user: { select: { id: true, name: true, image: true } },
        scheduledJobRun: { select: { id: true, job: { select: { id: true, name: true } } } },
      },
    })
    if (!chat) return notFound("Chat not found")

    const sanitized = await loadSanitizedChat(chat)
    return Response.json({
      ...sanitized,
      owner: chat.user,
      isYours: chat.user.id === auth.userId,
      sharedAt: chat.sharedToWorkspaceAt?.toISOString() ?? null,
      run: chat.scheduledJobRun
        ? { id: chat.scheduledJobRun.id, jobId: chat.scheduledJobRun.job.id, jobName: chat.scheduledJobRun.job.name }
        : null,
    })
  } catch (err) {
    return internalError(err)
  }
}
