import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  forbidden,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { generateWithOpenRouter } from "@/lib/llm/openrouter"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Selections longer than this are refused rather than truncated. Truncating
 * would return a rewrite of part of what the user highlighted, which reads as
 * the feature silently eating their text.
 */
const MAX_SELECTION_CHARS = 4_000

/** The named actions the selection bar offers, and what each asks for. */
const PRESETS: Record<string, string> = {
  improve: "Rewrite it to be clearer and better written, preserving its meaning.",
  shorten: "Rewrite it to be shorter, keeping every fact and instruction.",
  tone: "Rewrite it in a warmer, more direct tone, preserving its meaning.",
  grammar: "Fix only spelling, grammar and punctuation. Change nothing else.",
  explain: "Explain what it does, in at most three sentences.",
}

interface EditBody {
  selection?: string
  /** A preset key, or free-text instruction the user typed. */
  instruction?: string
}

/**
 * POST /api/workspaces/:id/edit-text — rewrite a selection from a workspace file.
 *
 * Members only, because a workspace file is workspace-private and this echoes
 * its content back through a third-party model. Gated on membership rather than
 * merely being signed in for the same reason the file routes are.
 *
 * Uses the shared best-effort OpenRouter helper — the same one behind chat-name
 * and PR-title suggestions. It returns the fallback rather than throwing when no
 * key is configured, so this degrades to "no change" instead of erroring.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params

  const [auth, workspace] = await Promise.all([
    requireAuth(),
    prisma.workspace.findFirst({
      where: { id, archived: false },
      select: { id: true, members: { select: { userId: true } } },
    }),
  ])
  if (isAuthError(auth)) return auth
  if (!workspace) return notFound("Workspace not found")
  if (!workspace.members.some((m) => m.userId === auth.userId)) {
    return forbidden("Join this workspace first")
  }

  try {
    const body: EditBody = await req.json()
    const selection = body.selection?.trim()
    const instruction = body.instruction?.trim()

    if (!selection) return badRequest("selection is required")
    if (!instruction) return badRequest("instruction is required")
    if (selection.length > MAX_SELECTION_CHARS) {
      return badRequest(`Select at most ${MAX_SELECTION_CHARS} characters`)
    }

    const task = PRESETS[instruction] ?? instruction
    const prompt = [
      "You are editing a fragment of a file in a shared agent workspace.",
      `Task: ${task}`,
      "",
      "Return ONLY the resulting text. No preamble, no explanation, no code fences,",
      "no quotes around it. Preserve the original indentation and line breaks.",
      "",
      "---",
      selection,
      "---",
    ].join("\n")

    // The fallback is the unchanged selection: with no key configured, "Keep"
    // becomes a no-op rather than an error the user has to understand.
    const text = await generateWithOpenRouter(prompt, { fallback: selection })
    return Response.json({ text, unchanged: text === selection })
  } catch (err) {
    return internalError(err)
  }
}
