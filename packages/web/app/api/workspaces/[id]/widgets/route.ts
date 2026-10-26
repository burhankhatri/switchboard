import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, badRequest, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { createWidget, reorderWidgets } from "@/lib/workspace-home/widget-store"

type Ctx = { params: Promise<{ id: string }> }

interface CreateBody {
  type?: unknown
  title?: unknown
  content?: unknown
  key?: unknown
  /** "pin" when made from a chat message or a file, otherwise "manual". */
  via?: unknown
  sourceChatId?: unknown
  sourceMessageId?: unknown
}

/**
 * POST /api/workspaces/:id/widgets — add a widget to the home page.
 *
 * Any member may. A pin from a chat may only cite the caller's own chat in
 * this workspace: the source becomes a link on everyone's home page, and
 * citing someone else's private chat would advertise that it exists.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON")
  }

  try {
    let chatId: string | null = null
    let messageId: string | null = null
    if (body.sourceChatId !== undefined && body.sourceChatId !== null) {
      if (typeof body.sourceChatId !== "string") return badRequest("sourceChatId must be a string")
      const chat = await prisma.chat.findFirst({
        where: { id: body.sourceChatId, userId: auth.userId, workspaceId: id },
        select: { id: true },
      })
      if (!chat) return badRequest("You can only pin from your own chats in this workspace")
      chatId = chat.id
      if (typeof body.sourceMessageId === "string") {
        // A message that has only just streamed in can still carry a client
        // id. The chat is the source that matters; the message link is a
        // nicety, so an unknown id is dropped rather than refusing the pin.
        const message = await prisma.message.findFirst({
          where: { id: body.sourceMessageId, chatId },
          select: { id: true },
        })
        messageId = message?.id ?? null
      }
    }

    const result = await createWidget(
      { id, path: gate.workspace.path },
      { type: body.type, title: body.title, content: body.content, key: body.key },
      {
        userId: auth.userId,
        via: body.via === "pin" || chatId ? "pin" : "manual",
        chatId,
        messageId,
      }
    )
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ widget: result.value }, { status: 201 })
  } catch (err) {
    return internalError(err)
  }
}

/** PUT /api/workspaces/:id/widgets — reorder: { ids: [...] } in display order. */
export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown }
    const result = await reorderWidgets({ id, path: gate.workspace.path }, body.ids)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json(result.value)
  } catch (err) {
    return internalError(err)
  }
}
