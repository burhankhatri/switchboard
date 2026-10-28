import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import { finalTurnContent } from "@/lib/turn-outcome"

import { autoPushChat } from "@/lib/git/auto-push"
import { notifyAsync } from "@/lib/db/notifications"
import type { LongTurnNotice } from "./long-turn"
import type { ChatWithMessages } from "./types"

// =============================================================================
// Interactive Chat Finalization
// =============================================================================

export async function finalizeInteractiveChat(
  chat: ChatWithMessages,
  snapshot: AgentSnapshot,
  daytona: Daytona
) {
  // 1. Update message content (same as SSE stream does). Best-effort and
  //    NUL-sanitized: a failing message write must NOT prevent the status reset
  //    in step 4 below, or the chat is stranded as permanently "running".
  const assistantMessage = chat.messages[0]

  if (assistantMessage) {
    const final = finalTurnContent(snapshot)
    try {
      await prisma.message.update({
        where: { id: assistantMessage.id },
        data: {
          content: stripNullBytes(final.content),
          ...(final.isError ? { isError: true } : {}),
          toolCalls:
            snapshot.toolCalls.length > 0
              ? (stripNullBytesDeep(snapshot.toolCalls) as unknown as Prisma.InputJsonValue)
              : undefined,
          contentBlocks:
            snapshot.contentBlocks.length > 0
              ? (stripNullBytesDeep(snapshot.contentBlocks) as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      })
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to persist message for chat ${chat.id}:`, err)
    }
  }

  // 2. Finalize the turn
  if (chat.sandboxId && chat.backgroundSessionId) {
    try {
      const sandbox = await daytona.get(chat.sandboxId)
      await finalizeTurn(sandbox, chat.backgroundSessionId, {
        repoPath: `${PATHS.SANDBOX_HOME}/project`,
      })

      // 2b. Meter token/cost usage for this turn via tokscale (best-effort).
      // Runs while the sandbox is still alive; attribution (pool/provider) is
      // read from the assistant message stamped at send time.
      await meterAssistantTurn(sandbox, {
        userId: chat.userId,
        chatId: chat.id,
        messageId: assistantMessage?.id ?? null,
        messageMetadata: assistantMessage?.metadata,
        agent: chat.agent,
        sessionId: snapshot.sessionId,
      })

      // 3. Auto-push before the status reset below releases the chat. Same
      //    backend routine the SSE stream calls — conflict guard, deduped
      //    failure message, stale-failure cleanup all live in autoPushChat.
      if (chat.branch && chat.repo && chat.repo !== "__new__") {
        await autoPushChat({
          sandbox,
          repoPath: `${PATHS.SANDBOX_HOME}/project`,
          chatId: chat.id,
          userId: chat.userId,
          branch: chat.branch,
        })
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to finalize chat ${chat.id}:`, err)
    }
  }

  // 4. Update chat status
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "ready",
      backgroundSessionId: null,
      sessionId: snapshot.sessionId || undefined,
      lastActiveAt: new Date(),
    },
  })
}

export async function markChatError(chatId: string, reason: string) {
  // Update chat status
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      status: "error",
      backgroundSessionId: null,
    },
  })

  // Create error message
  await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
  })
}

/**
 * Tell the chat's owner once that this turn is close to the hard stop. "Once"
 * is kept on the assistant message's metadata, because the cron runs every
 * minute and the turn can last another five.
 */
export async function warnLongTurnOnce(chat: ChatWithMessages, notice: LongTurnNotice) {
  const assistantMessage = chat.messages[0]
  if (!assistantMessage) return
  const metadata = (assistantMessage.metadata ?? {}) as Record<string, unknown>
  if (metadata.longTurnWarnedAt) return

  await prisma.message.update({
    where: { id: assistantMessage.id },
    data: {
      metadata: {
        ...metadata,
        longTurnWarnedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
    },
  })
  notifyAsync({
    userId: chat.userId,
    kind: "agent_long_turn",
    title: notice.title,
    body: notice.body,
    chatId: chat.id,
    workspaceId: chat.workspaceId ?? undefined,
  })
}
