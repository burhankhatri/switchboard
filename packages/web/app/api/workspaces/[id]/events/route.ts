import type { NextRequest } from "next/server"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { listWorkspaceEvents } from "@/lib/workspace-home/feed"

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/:id/events?before=<eventId> — older pages of the feed.
 *
 * The first page arrives with /home; this serves "Load older". Membership is
 * re-checked on every page, so a member removed while scrolling stops seeing
 * the workspace at the next request rather than at their next sign-in.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    const before = req.nextUrl.searchParams.get("before")
    return Response.json(await listWorkspaceEvents(id, { before }))
  } catch (err) {
    return internalError(err)
  }
}
