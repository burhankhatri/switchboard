/**
 * Test-only workspace creation.
 *
 * The real POST /api/workspaces requires GitHub auth because it writes a
 * workspace folder into the workspaces repo, which E2E has no token for. That
 * blocks testing everything downstream of a workspace existing — including the
 * membership notification, whose whole point is that one person acts on
 * another.
 *
 * This creates the rows and nothing else, so the tests that matter still drive
 * the real routes: the member add below goes through
 * POST /api/workspaces/[id]/members exactly as the UI does.
 *
 * ONLY enabled when ENABLE_TEST_AUTH=true.
 */

import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"

export async function POST(req: Request): Promise<Response> {
  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return Response.json({ error: "Test routes not enabled" }, { status: 403 })
  }

  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  try {
    const body = await req.json().catch(() => ({}))
    const name: string = typeof body?.name === "string" ? body.name : "Test Workspace"
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`

    const workspace = await prisma.workspace.create({
      data: {
        slug,
        name,
        repo: "test/agent-workspaces",
        path: `workspaces/${slug}`,
        createdById: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, slug: true, name: true },
    })

    return Response.json({ workspace })
  } catch (err) {
    return internalError(err)
  }
}
