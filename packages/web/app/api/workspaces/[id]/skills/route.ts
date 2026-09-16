import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireGitHubAuth,
  isGitHubAuthError,
  notFound,
  forbidden,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from "@/lib/workspace-repo"
import {
  listSkillSlugs,
  parseSkillFrontmatter,
  scaffoldSkillMarkdown,
  skillPath,
  skillSlug,
  type SkillSummary,
} from "@/lib/workspace-skills"

type Ctx = { params: Promise<{ id: string }> }

/** Longest description we will commit — one sentence, not a document. */
const MAX_DESCRIPTION = 500
/** Longest title. The slug caps shorter; this bounds what goes in the heading. */
const MAX_TITLE = 100

type Resolved =
  | { error: Response; auth?: undefined; workspace?: undefined }
  | {
      error?: undefined
      auth: { userId: string; token: string }
      workspace: { slug: string; path: string; baseBranch: string }
    }

/**
 * Members only, and the same shape both handlers need. Auth and the workspace
 * row overlap because only the membership filter depends on the auth result,
 * and these are two round trips to a cross-region database.
 */
async function resolveMember(id: string): Promise<Resolved> {
  const [auth, workspace] = await Promise.all([
    requireGitHubAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: {
        slug: true,
        path: true,
        baseBranch: true,
        members: { select: { userId: true } },
      },
    }),
  ])
  if (isGitHubAuthError(auth)) return { error: auth }
  if (!workspace) return { error: notFound("Workspace not found") }
  if (!workspace.members.some((m) => m.userId === auth.userId)) {
    return { error: forbidden("Join this workspace first") }
  }
  return { auth: { userId: auth.userId, token: auth.token }, workspace }
}

/**
 * GET /api/workspaces/:id/skills — what this workspace teaches its agent.
 *
 * Separate from the file listing because a skill is the thing people came for
 * and a file is an implementation detail of it. Descriptions come from each
 * SKILL.md's frontmatter, read server-side: those reads are ETag-cached and run
 * in parallel here, where one browser round trip covers all of them.
 */
export async function GET(_req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params
  const resolved = await resolveMember(id)
  if (resolved.error) return resolved.error
  const { auth, workspace } = resolved

  try {
    const files = await listWorkspaceFiles(auth.token, workspace.path, workspace.baseBranch)
    const found = listSkillSlugs(files.workspace.map((f) => f.name))

    const skills: SkillSummary[] = await Promise.all(
      found.map(async ({ slug, extraFiles }) => {
        const path = skillPath(workspace.path, slug)
        // A skill whose SKILL.md cannot be read still exists — showing it
        // unnamed beats dropping it from a list people use to decide what the
        // agent knows.
        const parsed = await readWorkspaceFile(auth.token, path)
          .then((f) => parseSkillFrontmatter(f.content))
          .catch(() => null)
        return {
          slug,
          name: parsed?.name?.trim() || slug,
          description: parsed?.description?.trim() ?? "",
          path,
          extraFiles,
        }
      })
    )

    return Response.json({ skills })
  } catch (err) {
    return internalError(err)
  }
}

interface CreateBody {
  name?: string
  description?: string
}

/**
 * POST /api/workspaces/:id/skills — add a skill.
 *
 * The caller sends a name and a description; the server decides the path. That
 * split is deliberate: `.claude/skills/<slug>/SKILL.md` is what makes the agent
 * find the skill at all, so it is a rule the system enforces rather than
 * something the person adding a skill has to know.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params
  const resolved = await resolveMember(id)
  if (resolved.error) return resolved.error
  const { auth, workspace } = resolved

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid request body")
  }

  const title = (body.name ?? "").trim()
  const description = (body.description ?? "").trim()
  if (!title) return badRequest("Give the skill a name")
  if (title.length > MAX_TITLE) return badRequest("That name is too long")
  // Required, not optional: the description is what the model matches a task
  // against, so a skill without one is a file the agent will never open.
  if (!description) return badRequest("Describe when the agent should use this")
  if (description.length > MAX_DESCRIPTION) return badRequest("Keep the description to a sentence or two")

  const slug = skillSlug(title)
  if (!slug) return badRequest("Use some letters or numbers in the name")

  try {
    const files = await listWorkspaceFiles(auth.token, workspace.path, workspace.baseBranch)
    if (listSkillSlugs(files.workspace.map((f) => f.name)).some((s) => s.slug === slug)) {
      return badRequest(`This workspace already has a skill called "${slug}"`)
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    })
    const path = skillPath(workspace.path, slug)

    await writeWorkspaceFile(
      auth.token,
      path,
      scaffoldSkillMarkdown({ slug, title, description }),
      // No prior blob: a duplicate is refused above, and GitHub rejects a
      // create that would overwrite, so a race loses rather than clobbers.
      "",
      `Add ${slug} skill to ${workspace.slug} (via Shared Agents by ${user?.name ?? auth.userId})`
    )

    return Response.json(
      { skill: { slug, name: title, description, path, extraFiles: 0 } },
      { status: 201 }
    )
  } catch (err) {
    return internalError(err)
  }
}
