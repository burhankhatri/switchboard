import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, getChatWithAuth, notFound, internalError } from "@/lib/db/api-helpers"

// =============================================================================
// GET /api/chats/[chatId]/approvals — what the agent is waiting on, and what
// has been approved but not yet carried into a turn. Owner only.
// =============================================================================

type Ctx = { params: Promise<{ chatId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, auth.userId)
    if (!chat) return notFound("Chat not found")
    const approvals = await prisma.chatApproval.findMany({
      where: { chatId, status: { in: ["pending", "approved"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, count: true, campaign: true, status: true, createdAt: true },
    })
    return Response.json({
      approvals: approvals.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    })
  } catch (error) {
    return internalError(error)
  }
}
