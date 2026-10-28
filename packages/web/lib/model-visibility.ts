import { agentUsesSharedPool, type Agent, type CredentialFlags, type ModelOption } from "@switchboard/common"

/**
 * Which models the picker offers.
 *
 * OpenCode's free tier is where the sloppy turns came from: of 77 assistant
 * turns in the first two months, 25 ran on free big-pickle with 14% failed
 * tool calls (6% on GLM-5.2), real names in chat and a draft created on an
 * ambiguous ask. Once a workspace has a shared OpenCode key, the free models
 * are a worse option that costs nothing to offer and plenty to pick, so they
 * are hidden. A chat already on one keeps it visible so the picker can show
 * what it is on; custom endpoints are the user's own and stay.
 */
export function visibleModelOptions(
  agent: Agent,
  models: ModelOption[],
  flags: CredentialFlags | null | undefined,
  currentModel?: string | null
): ModelOption[] {
  if (agent !== "opencode" || !agentUsesSharedPool(agent, flags)) return models
  return models.filter(
    (m) =>
      m.requiresKey !== "none" ||
      m.value.startsWith("endpoint:") ||
      m.value === currentModel
  )
}
