import type { AgentMcpServer } from "@switchboard/agent-configuration"
import { mintRunToken } from "./run-token"

/**
 * The app's own origin, as reachable from inside a sandbox.
 *
 * A sandbox is not on this machine, so localhost is never right and a relative
 * URL is meaningless. NEXTAUTH_URL is the value already configured as "where
 * this app lives"; VERCEL_URL covers preview deployments, which do not get one.
 */
function publicOrigin(): string | null {
  const configured = process.env.NEXTAUTH_URL?.trim()
  if (configured) {
    // A localhost origin would resolve to the sandbox itself, which is a
    // confusing failure: the agent's tool call would connect to nothing.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(configured)) return null
    return configured.replace(/\/+$/, "")
  }
  const vercel = process.env.VERCEL_URL?.trim()
  return vercel ? `https://${vercel.replace(/\/+$/, "")}` : null
}

/**
 * The scheduler tool, as an MCP server entry for one run.
 *
 * Only offered to a run that is bound to a workspace: the tool needs somewhere
 * to put the job, and a tool that can only fail is worse than an absent one —
 * the model will try it, read the refusal, and spend a turn on it.
 *
 * Returns null when the app has no origin a sandbox could reach, which is the
 * normal case in local development. The run proceeds without the tool rather
 * than failing, and the agent simply tells the user to add the job by hand.
 */
export function schedulerMcpServer(params: {
  userId: string
  workspaceId: string | null | undefined
  chatId: string | null | undefined
}): AgentMcpServer | null {
  if (!params.workspaceId) return null

  const origin = publicOrigin()
  if (!origin) return null

  let bearerToken: string
  try {
    bearerToken = mintRunToken({
      userId: params.userId,
      workspaceId: params.workspaceId,
      chatId: params.chatId ?? null,
    })
  } catch (err) {
    // Missing signing secret. Loud in the log, silent for the run.
    console.error("[mcp/scheduler] could not mint a run token:", err)
    return null
  }

  return {
    name: "scheduler",
    url: `${origin}/api/mcp/scheduler`,
    bearerToken,
  }
}
