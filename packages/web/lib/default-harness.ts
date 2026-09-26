import { defaultAgentModel } from "@switchboard/common"
import type { Agent } from "@/lib/types"

/**
 * The harness every new chat and workspace starts on until someone picks
 * another: OpenCode on GLM-5.2 (OpenCode Go, run on the shared key).
 */
export const DEFAULT_HARNESS: { agent: Agent; model: string } = {
  agent: "opencode",
  model: defaultAgentModel.opencode,
}

/**
 * Agent and model for a new workspace. An explicitly chosen agent is kept; its
 * model is only pinned when given, so a non-OpenCode workspace is not left
 * holding GLM-5.2.
 */
export function workspaceHarness(body: { agent?: string | null; model?: string | null }): {
  agent: string
  model: string | null
} {
  if (!body.agent) return { agent: DEFAULT_HARNESS.agent, model: body.model ?? DEFAULT_HARNESS.model }
  return { agent: body.agent, model: body.model ?? null }
}

/**
 * Agent and model a draft chat is created with when its first message goes
 * out. What is being sent is what the composer shows, so it wins; the draft's
 * own record (often empty) is the fallback. Creating it from the draft alone
 * let the server fill in the workspace's agent, and the UI showed that agent
 * responding until the message switched the chat over.
 */
export function agentModelForNewChat(
  draft: { agent?: string | null; model?: string | null },
  sent: { agent?: string | null; model?: string | null }
): { agent: string | null; model: string | null } {
  return { agent: sent.agent ?? draft.agent ?? null, model: sent.model ?? draft.model ?? null }
}
