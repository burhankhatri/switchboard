/**
 * Test-only chat creation.
 *
 * Setting Chat.awaitingInput for real requires an agent run in a Daytona
 * sandbox, which E2E has no key for. That half of the chain — agent emits the
 * marker, persist sets the flag — is covered by the persist-snapshot unit
 * tests; this covers the other half, that a flagged chat is marked in the
 * sidebar.
 *
 * A message is created alongside because the sidebar hides chats with no
 * messages and no parent (see isChatVisibleForFilter), so a bare chat row would
 * never render and the test would pass for the wrong reason.
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
    const displayName: string =
      typeof body?.displayName === "string" ? body.displayName : "Test Chat"
    const awaitingInput = body?.awaitingInput === true
    // The sidebar is workspace-scoped, so a chat with no workspace never
    // renders in it (see isChatVisibleForFilter). Tests that assert on a
    // sidebar row have to bind the chat to the workspace they activate.
    const workspaceId: string | undefined =
      typeof body?.workspaceId === "string" ? body.workspaceId : undefined

    const chat = await prisma.chat.create({
      data: {
        userId,
        displayName,
        repo: "test/repo",
        baseBranch: "main",
        agent: "eliza",
        status: "ready",
        awaitingInput,
        workspaceId,
        messages: {
          create: {
            role: "assistant",
            content: awaitingInput
              ? "1. Which campaign should I use?"
              : "Done.",
            timestamp: BigInt(Date.now()),
          },
        },
      },
      select: { id: true, displayName: true, awaitingInput: true, workspaceId: true },
    })

    return Response.json({ chat })
  } catch (err) {
    return internalError(err)
  }
}
