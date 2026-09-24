import type { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth } from "@/lib/db/api-helpers"
import { gitTokenForRun } from "@/lib/git/repo-token"
import { ensureSandboxForChat } from "@/app/api/chats/[chatId]/messages/_lib/ensure-sandbox"

type DaytonaSandbox = Awaited<ReturnType<Daytona["get"]>>

/**
 * Bring back a chat's sandbox for a git action that needs its files (rebase,
 * force-push, branch listing).
 *
 * A GitHub-backed chat's sandbox is deleted as soon as it stops, and until now
 * only sending a message recreated it, so these actions failed on any chat idle
 * for more than a few minutes. This goes through the same ensureSandboxForChat
 * a message uses, so the branch is restored exactly as it would be there.
 *
 * Returns a Response when the chat cannot have a sandbox right now: busy, no
 * branch yet (nothing to act on), or no token to clone with.
 */
export async function recreateChatSandbox(params: {
  daytona: Daytona
  chatId: string
  userId: string
  userToken: string
}): Promise<DaytonaSandbox | Response> {
  const { daytona, chatId, userId, userToken } = params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 })
  if (chat.status === "creating" || chat.status === "running") {
    return Response.json({ error: "Chat is busy" }, { status: 409 })
  }
  if (!chat.branch) {
    return Response.json({ error: "This chat has no branch yet. Send a message first." }, { status: 409 })
  }

  const githubToken = await gitTokenForRun({
    userId,
    repo: chat.repo,
    workspaceId: chat.workspaceId,
    userToken,
  })
  const state = {
    sandboxId: chat.sandboxId,
    branch: chat.branch,
    previewUrlPattern: chat.previewUrlPattern,
    createdSandbox: false,
  }

  try {
    const ensured = await ensureSandboxForChat({
      daytona,
      chat,
      chatId,
      payload: {},
      githubToken,
      identityToken: userToken,
      userId,
      state,
    })
    return ensured instanceof Response ? ensured : ensured.sandbox
  } catch (err) {
    // ensureSandboxForChat marks the chat "creating" before it clones. Put the
    // status back, or the chat reads as busy and refuses every later message.
    await prisma.chat
      .update({ where: { id: chatId }, data: { status: chat.status } })
      .catch(() => {})
    throw err
  }
}
