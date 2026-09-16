import type { AgentMcpServer } from "@switchboard/agent-configuration"
import { mintRunToken } from "./run-token"

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i

/**
 * The app's own origin, as reachable from inside a sandbox.
 *
 * A sandbox runs on Daytona, not on this machine, so a localhost origin
 * resolves to the sandbox itself and a relative URL means nothing.
 *
 * SANDBOX_CALLBACK_ORIGIN is checked first and exists to be set to a tunnel in
 * local development. It is deliberately separate from NEXTAUTH_URL: that one
 * is also the OAuth callback base, so repointing it at a tunnel breaks GitHub
 * sign-in, and anyone trying to test this locally would hit that immediately.
 */
function publicOrigin(): string | null {
  const explicit = process.env.SANDBOX_CALLBACK_ORIGIN?.trim()
  if (explicit && !LOCAL_ORIGIN.test(explicit)) return explicit.replace(/\/+$/, "")

  const configured = process.env.NEXTAUTH_URL?.trim()
  if (configured && !LOCAL_ORIGIN.test(configured)) return configured.replace(/\/+$/, "")

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
  if (!origin) {
    // Loud, because the symptom is silent and misleading: with no tool the
    // agent improvises, and what it improvises is a crontab inside a sandbox
    // that is about to be destroyed. Better to see this line in the log than
    // to debug a schedule that never fires.
    console.warn(
      "[mcp/scheduler] no sandbox-reachable origin — the scheduler tool is NOT available " +
        "to this run. Set SANDBOX_CALLBACK_ORIGIN to a public URL (a tunnel, in local dev)."
    )
    return null
  }

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
