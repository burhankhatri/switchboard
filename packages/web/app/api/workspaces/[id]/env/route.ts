import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  forbidden,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { encryptSecret } from "@/lib/db/encryption"
import { workspaceEnvKeys, isValidEnvName } from "@/lib/workspace"
import { logActivityAsync } from "@/lib/db/activity-log"

type Ctx = { params: Promise<{ id: string }> }

/** Owner-only. Returns the membership row, or a Response to return directly. */
type OwnerGate =
  | { ok: true; workspace: { id: string; slug: string; environmentVariables: unknown } }
  | { ok: false; response: Response }

async function requireOwner(workspaceId: string, userId: string): Promise<OwnerGate> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, archived: false },
    select: { id: true, slug: true, environmentVariables: true },
  })
  if (!workspace) return { ok: false, response: notFound("Workspace not found") }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (membership?.role !== "owner") {
    // Same shape whether you are a member or a stranger — knowing you are "just
    // a member" is not information worth leaking on a permissions failure.
    return { ok: false, response: forbidden("Only workspace owners can manage connections") }
  }
  return { ok: true, workspace }
}

/**
 * GET — the NAMES of this workspace's connections. Never the values.
 *
 * There is no endpoint that returns a value. Once set, a secret only ever
 * leaves the server by being injected into a sandbox at spin-up.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const workspace = await prisma.workspace.findFirst({
    where: { id, archived: false },
    select: { environmentVariables: true, members: { where: { userId: auth.userId }, select: { role: true } } },
  })
  if (!workspace) return notFound("Workspace not found")
  if (workspace.members.length === 0) return forbidden("Join this workspace first")

  return Response.json({ keys: workspaceEnvKeys(workspace) })
}

interface PutBody {
  /** Key -> value to set. A null value deletes the key. */
  env?: Record<string, string | null>
}

/**
 * PUT — set or delete connection values. Owner-only.
 *
 * Merges rather than replaces, so a client that only knows the key names (which
 * is all GET returns) can update one connection without wiping the rest.
 */
export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id } = await params

  const gate = await requireOwner(id, userId)
  if (!gate.ok) return gate.response
  const { workspace } = gate

  try {
    const body: PutBody = await req.json()
    const entries = Object.entries(body.env ?? {})
    if (entries.length === 0) return badRequest("env is required")

    const invalid = entries.map(([k]) => k).filter((k) => !isValidEnvName(k))
    if (invalid.length > 0) {
      return badRequest(
        `Invalid variable name(s): ${invalid.join(", ")}. Use A-Z, 0-9 and underscore, starting with a letter.`
      )
    }

    const current = (workspace.environmentVariables as Record<string, string> | null) ?? {}
    const next = { ...current }
    const set: string[] = []
    const removed: string[] = []

    for (const [key, value] of entries) {
      if (value === null || value === "") {
        delete next[key]
        removed.push(key)
      } else {
        next[key] = encryptSecret(value)
        set.push(key)
      }
    }

    await prisma.workspace.update({
      where: { id },
      data: { environmentVariables: next },
    })

    // Names only. A value must never reach a log.
    logActivityAsync(userId, "workspace_env_updated", {
      workspaceSlug: workspace.slug,
      set,
      removed,
    })

    return Response.json({ keys: Object.keys(next).sort() })
  } catch (err) {
    return internalError(err)
  }
}
