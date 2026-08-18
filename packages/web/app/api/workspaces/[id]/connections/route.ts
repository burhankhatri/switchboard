import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth, isAuthError, notFound, forbidden, badRequest, internalError,
} from "@/lib/db/api-helpers"
import { encryptSecret } from "@/lib/db/encryption"
import {
  isValidConnectionSlug, restEnvNames, type AuthType,
} from "@/lib/workspace-connections"
import { logActivityAsync } from "@/lib/db/activity-log"

type Ctx = { params: Promise<{ id: string }> }

const AUTH_TYPES: AuthType[] = ["none", "bearer", "header", "query", "basic"]

async function gate(workspaceId: string, userId: string, needOwner: boolean) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, archived: false },
    select: { id: true, slug: true },
  })
  if (!workspace) return { ok: false as const, response: notFound("Workspace not found") }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) return { ok: false as const, response: forbidden("Join this workspace first") }
  if (needOwner && membership.role !== "owner") {
    return { ok: false as const, response: forbidden("Only workspace owners can manage connections") }
  }
  return { ok: true as const, workspace }
}

/**
 * GET — connections for a workspace, without secrets.
 *
 * Returns the env var names a REST connection provides, because that is what a
 * skill in the repo will reference and the author needs to know them.
 */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const g = await gate(id, auth.userId, false)
  if (!g.ok) return g.response

  const rows = await prisma.workspaceConnection.findMany({
    where: { workspaceId: id },
    orderBy: { name: "asc" },
    select: {
      id: true, kind: true, name: true, slug: true, description: true,
      baseUrl: true, authType: true, authParam: true, mcpUrl: true,
      encryptedSecret: true, createdAt: true,
    },
  })

  return Response.json({
    connections: rows.map(({ encryptedSecret, ...c }) => ({
      ...c,
      hasSecret: !!encryptedSecret,
      env: c.kind === "rest" ? restEnvNames(c.slug) : null,
    })),
  })
}

interface CreateBody {
  kind?: string
  name?: string
  slug?: string
  description?: string
  baseUrl?: string
  authType?: string
  authParam?: string
  mcpUrl?: string
  secret?: string
}

/** POST — add a connection. Owner-only: a connection grants the agent reach. */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id } = await params

  const g = await gate(id, userId, true)
  if (!g.ok) return g.response

  try {
    const body: CreateBody = await req.json()
    const kind = body.kind
    if (kind !== "rest" && kind !== "mcp") return badRequest('kind must be "rest" or "mcp"')

    const name = body.name?.trim()
    if (!name) return badRequest("name is required")

    const slug = (body.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    if (!isValidConnectionSlug(slug)) return badRequest("slug must be lowercase letters, digits and hyphens")

    if (kind === "rest") {
      if (!body.baseUrl?.startsWith("https://")) {
        // http:// would send the credential in clear text on every call.
        return badRequest("baseUrl must be an https:// URL")
      }
      const authType = (body.authType ?? "none") as AuthType
      if (!AUTH_TYPES.includes(authType)) return badRequest("invalid authType")
      if ((authType === "header" || authType === "query") && !body.authParam?.trim()) {
        return badRequest(`authParam is required for authType "${authType}"`)
      }
      if (authType !== "none" && !body.secret?.trim()) {
        return badRequest("secret is required unless authType is \"none\"")
      }
    } else if (!body.mcpUrl?.startsWith("https://")) {
      return badRequest("mcpUrl must be an https:// URL")
    }

    const existing = await prisma.workspaceConnection.findUnique({
      where: { workspaceId_slug: { workspaceId: id, slug } },
      select: { id: true },
    })
    if (existing) return badRequest(`A connection with slug "${slug}" already exists`)

    const created = await prisma.workspaceConnection.create({
      data: {
        workspaceId: id,
        kind,
        name,
        slug,
        description: body.description?.trim() || null,
        baseUrl: kind === "rest" ? body.baseUrl! : null,
        authType: kind === "rest" ? (body.authType ?? "none") : null,
        authParam: body.authParam?.trim() || null,
        mcpUrl: kind === "mcp" ? body.mcpUrl! : null,
        encryptedSecret: body.secret?.trim() ? encryptSecret(body.secret.trim()) : null,
        createdById: userId,
      },
      select: { id: true, kind: true, name: true, slug: true },
    })

    // Names only — a secret must never reach an audit row.
    logActivityAsync(userId, "workspace_connection_added", {
      workspaceSlug: g.workspace.slug,
      connectionSlug: slug,
      connectionKind: kind,
    })

    return Response.json(
      { connection: { ...created, env: kind === "rest" ? restEnvNames(slug) : null } },
      { status: 201 }
    )
  } catch (err) {
    return internalError(err)
  }
}

/** DELETE — remove a connection by slug. Owner-only. */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id } = await params

  const g = await gate(id, userId, true)
  if (!g.ok) return g.response

  const slug = req.nextUrl.searchParams.get("slug")
  if (!slug) return badRequest("slug is required")

  const deleted = await prisma.workspaceConnection.deleteMany({
    where: { workspaceId: id, slug },
  })
  if (deleted.count === 0) return notFound("Connection not found")

  logActivityAsync(userId, "workspace_connection_removed", {
    workspaceSlug: g.workspace.slug,
    connectionSlug: slug,
  })
  return Response.json({ removed: slug })
}
