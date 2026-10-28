import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// POST /api/chats/[chatId]/approvals/[approvalId]  { decision: "approve" | "decline" }
// =============================================================================
//
// Owner only, through getChatWithAuth: the person who owns the chat is the one
// whose agent asked. An approval moves pending -> approved here; the next turn
// spends it (consumeApprovalEnv). A decision on an answered row is a 400, so a
// double click cannot approve twice.

type Ctx = { params: Promise<{ chatId: string; approvalId: string }> }

export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId, approvalId } = await params

  let decision: unknown
  try {
    decision = ((await req.json()) as { decision?: unknown })?.decision
  } catch {
    return badRequest("Body must be JSON")
  }
  if (decision !== "approve" && decision !== "decline") {
    return badRequest('decision must be "approve" or "decline"')
  }

  try {
    const chat = await getChatWithAuth(chatId, auth.userId)
    if (!chat) return notFound("Chat not found")

    const updated = await prisma.chatApproval.updateMany({
      where: { id: approvalId, chatId, status: "pending" },
      data: { status: decision === "approve" ? "approved" : "declined", decidedAt: new Date() },
    })
    if (updated.count === 0) return badRequest("That request has already been answered")

    // The chat was parked as awaiting input when the agent asked. Answering is
    // the input; if nothing else is waiting, clear the badge.
    const stillPending = await prisma.chatApproval.count({ where: { chatId, status: "pending" } })
    if (stillPending === 0) {
      await prisma.chat.update({ where: { id: chatId }, data: { awaitingInput: false } })
    }
    return Response.json({ id: approvalId, status: decision === "approve" ? "approved" : "declined" })
  } catch (error) {
    return internalError(error)
  }
}
