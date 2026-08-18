import { prisma } from "@/lib/db/prisma"
import { forbidden, notFound } from "@/lib/db/api-helpers"

/**
 * Kept out of lib/workspace.ts deliberately.
 *
 * That module is pure resolution logic — decryption, prompt assembly, env key
 * derivation — and is imported by unit tests that have no database. Importing
 * prisma there made the client construct at module load, so those tests failed
 * to collect with "DATABASE_URL is not set" before a single assertion ran.
 */

/**
 * Resolve a workspace and the caller's membership in ONE query.
 *
 * Every workspace route needs the same two facts before it can do anything:
 * does this workspace exist, and is the caller in it. Written as two awaits
 * that is two sequential round trips to a cross-region database before the
 * route's own query even starts — and opening a workspace fans out to several
 * of these routes at once, so the cost multiplies and they queue behind each
 * other on the connection pool. Membership rides along as a filtered relation
 * instead.
 *
 * Returns a ready-to-return Response on failure so callers stay flat.
 */
export async function gateWorkspace(
  workspaceId: string,
  userId: string,
  opts: { requireOwner?: boolean } = {}
): Promise<
  | { ok: true; workspace: { id: string; slug: string; path: string }; role: string }
  | { ok: false; response: Response }
> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, archived: false },
    select: {
      id: true,
      slug: true,
      path: true,
      members: { where: { userId }, select: { role: true } },
    },
  })
  if (!workspace) {
    return { ok: false, response: notFound("Workspace not found") }
  }
  const role = workspace.members[0]?.role
  if (!role) {
    return { ok: false, response: forbidden("Join this workspace first") }
  }
  if (opts.requireOwner && role !== "owner") {
    return { ok: false, response: forbidden("Only workspace owners can do that") }
  }
  const { members: _members, ...rest } = workspace
  return { ok: true, workspace: rest, role }
}
