import type { NextRequest } from "next/server"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { loadWorkspaceHome } from "@/lib/workspace-home/home"

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/:id/home — everything the home page shows except the
 * brief.
 *
 * Same shape of reasoning as /overview: one membership check, then the reads
 * run together. The brief (HOME.md) is deliberately left out — it is a GitHub
 * read with its own ETag cache, and folding it in would make the whole page
 * wait on GitHub.
 */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const gate = await gateWorkspace(id, auth.userId)
  if (!gate.ok) return gate.response

  try {
    return Response.json(await loadWorkspaceHome(id, auth.userId))
  } catch (err) {
    return internalError(err)
  }
}
