import type { NextRequest } from "next/server"
import { requireAuth, isAuthError, badRequest, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { deleteWidget, updateWidget } from "@/lib/workspace-home/widget-store"

type Ctx = { params: Promise<{ id: string; widgetId: string }> }

/**
 * PATCH  /api/workspaces/:id/widgets/:widgetId — edit { title?, content? }
 * DELETE /api/workspaces/:id/widgets/:widgetId — remove for everyone
 *
 * Any member, on any widget: the home page is the team's, and every change is
 * attributed and recorded in the feed rather than gated.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, widgetId } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  let body: { title?: unknown; content?: unknown }
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON")
  }

  try {
    const result = await updateWidget(
      { id, path: gate.workspace.path },
      { id: widgetId },
      { title: body.title, content: body.content },
      { userId: auth.userId, via: "manual" }
    )
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ widget: result.value })
  } catch (err) {
    return internalError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id, widgetId } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    const result = await deleteWidget({ id, path: gate.workspace.path }, widgetId, {
      userId: auth.userId,
      via: "manual",
    })
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return new Response(null, { status: 204 })
  } catch (err) {
    return internalError(err)
  }
}
