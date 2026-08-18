import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import { decryptWorkspaceEnv } from "@/lib/workspace"
import { NEW_REPOSITORY } from "@/lib/types"
import { getEnvForModel, type CustomEndpoint } from "@switchboard/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { ChatRecord, MessagePayload } from "./types"

/**
 * Build the environment passed to the agent process.
 *
 * Precedence, lowest to highest:
 *   system (model/agent)  <  user repo-level  <  user chat-level  <  WORKSPACE
 *
 * The workspace is last on purpose, and it is the one deviation from "user vars
 * win". A workspace connection is shared infrastructure: if a chat-level
 * variable could shadow CRM_KEY, any member could point a shared workspace at a
 * system of record of their choosing while everything still looked normal. User
 * vars still override system defaults — they just cannot silently replace a
 * connection the workspace declares.
 */
export async function buildAgentEnv(params: {
  chat: ChatRecord
  userId: string
  payload: MessagePayload
  credentials: Credentials
  customEndpoints?: CustomEndpoint[]
}): Promise<Record<string, string>> {
  const { chat, userId, payload, credentials, customEndpoints } = params

  const systemEnv = getEnvForModel(payload.model, payload.agent as Agent, credentials, customEndpoints)

  // Fetch user-defined environment variables (repo-level then chat-level, chat takes precedence)
  const userEnv: Record<string, string> = {}

  // Get repo-level env vars from user
  if (chat.repo !== NEW_REPOSITORY) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })
    const repoEnvVars = (user?.repoEnvironmentVariables as Record<string, Record<string, string>>)?.[chat.repo]
    if (repoEnvVars) {
      for (const [key, encryptedValue] of Object.entries(repoEnvVars)) {
        if (encryptedValue) {
          userEnv[key] = decrypt(encryptedValue)
        }
      }
    }
  }

  // Get chat-level env vars (overrides repo-level)
  const chatEnvVars = chat.environmentVariables as Record<string, string> | null
  if (chatEnvVars) {
    for (const [key, encryptedValue] of Object.entries(chatEnvVars)) {
      if (encryptedValue) {
        userEnv[key] = decrypt(encryptedValue)
      }
    }
  }

  // Membership is re-checked on EVERY run, not just when the chat was bound.
  // A chat keeps its workspaceId for life, so without this, leaving a workspace
  // would revoke nothing — the next turn would still be handed the current
  // credential, including one rotated in after the person left.
  let workspaceEnv: Record<string, string> = {}
  if (chat.workspaceId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: chat.workspaceId, userId } },
      select: { role: true },
    })
    if (!member) {
      throw new Error(
        "You are no longer a member of this workspace, so its connections were not loaded."
      )
    }
    // Throws if a value cannot be decrypted, so a broken connection fails at
    // spin-up rather than mid-task or by sending garbage to the CRM as a key.
    workspaceEnv = decryptWorkspaceEnv(chat.workspace)
  }

  const shadowed = Object.keys(workspaceEnv).filter((k) => k in userEnv)
  if (shadowed.length > 0) {
    console.warn(
      `[agent-env] chat ${chat.id}: user vars ignored, workspace owns ${shadowed.join(", ")}`
    )
  }

  return { ...systemEnv, ...userEnv, ...workspaceEnv }
}
