import { resolveModelForAgent, type Agent, type CredentialFlags, type CustomEndpoint } from "@/lib/types"

/**
 * The default model to show after the default agent changes in Settings.
 *
 * Keeps the current model when the user can run it on the new agent, and
 * otherwise resolves the agent's default against their credentials. It used to
 * take the first model in the agent's list, which for OpenCode is the free
 * opencode/big-pickle, even when the shared Go key could run GLM-5.2. Settings
 * then saved that on close and every run went to the free tier.
 */
export function defaultModelAfterAgentChange(
  agent: Agent,
  currentModel: string | null | undefined,
  flags: CredentialFlags | null | undefined,
  endpoints?: CustomEndpoint[]
): string {
  return resolveModelForAgent(agent, flags, currentModel, endpoints)
}
