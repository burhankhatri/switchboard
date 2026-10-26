import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  forbidden,
  internalError,
} from "@/lib/db/api-helpers"
import { recordWorkspaceEventAsync } from "@/lib/workspace-home/events"

// =============================================================================
// POST /api/chats/[chatId]/workspace-share — let the workspace's members read it
// DELETE                                   — make it private again
// =============================================================================
//
// Owner only, through getChatWithAuth. Distinct from /share, which mints a
// public link: sharing with colleagues never creates one, and a public link
// never grants anything inside the workspace.

type Ctx = { params: Promise<{ chatId: string }> }

export async function POST(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")
    if (!chat.workspaceId) return badRequest("This chat is not in a workspace")

    // Sharing into a workspace you have left would put your chat in front of
    // people you no longer work with, and you could not unshare it from there.
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: chat.workspaceId, userId } },
      select: { role: true },
    })
    if (!member) return forbidden("Join this workspace first")

    if (chat.sharedToWorkspaceAt) {
      return Response.json({ sharedToWorkspaceAt: chat.sharedToWorkspaceAt.toISOString() })
    }

    const sharedAt = new Date()
    await prisma.chat.update({ where: { id: chatId }, data: { sharedToWorkspaceAt: sharedAt } })
    recordWorkspaceEventAsync({
      workspaceId: chat.workspaceId,
      kind: "chat_shared",
      summary: `Shared a chat: ${chat.displayName || "Untitled chat"}`,
      actorUserId: userId,
      chatId,
    })
    return Response.json({ sharedToWorkspaceAt: sharedAt.toISOString() })
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    // No event: the share event stays, and the feed stops linking it because
    // links are resolved against current visibility when the feed is read.
    if (chat.sharedToWorkspaceAt) {
      await prisma.chat.update({ where: { id: chatId }, data: { sharedToWorkspaceAt: null } })
    }
    return Response.json({ sharedToWorkspaceAt: null })
  } catch (error) {
    return internalError(error)
  }
}
