/**
 * Agent Session utilities for Simple Chat
 * Uses shared code from @switchboard/common
 */

import {
  createSession,
  getSession,
  type Event,
  type EndEvent,
} from "@switchboard/sdk"
import {
  agentToProvider,
  type Agent,
  type ContentBlock,
  type ToolCall,
} from "@switchboard/common"
import {
  buildSystemPrompt,
  buildContentBlocks,
  type SkillCatalogEntry,
} from "./session"
import { isSafeWorkspacePath } from "./git/ref-validation"
import {
  setupClaudePermissions,
  setupCodexPermissions,
  renderOpenCodePermissionEnv,
} from "@switchboard/agent-configuration/permissions"
import {
  setupMcpForAgent,
  type AgentMcpServer,
} from "@switchboard/agent-configuration/mcp"
import { DEFAULT_GIT_POLICY } from "./git-policy"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

// Re-export Agent type for convenience
export type { Agent }

/**
 * Best-effort serialization of an unknown thrown value. Avoids the
 * "Unknown error" trap when something non-Error (a plain object, an SDK
 * rejection, a string) bubbles up — at minimum we surface *what* it was.
 */
export function formatAgentError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== "Error" ? `${err.name}: ` : ""
    const cause = (err as { cause?: unknown }).cause
    const causeMsg =
      cause instanceof Error
        ? ` (cause: ${cause.message})`
        : cause != null
        ? ` (cause: ${String(cause)})`
        : ""
    return `${name}${err.message || "Error"}${causeMsg}`
  }
  if (typeof err === "string") return err || "Empty error"
  if (err && typeof err === "object") {
    try {
      const json = JSON.stringify(err)
      if (json && json !== "{}") return json
    } catch {
      /* fall through */
    }
  }
  return String(err)
}

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionOptions {
  /** Clone root inside the sandbox. Git operations always use THIS path. */
  repoPath: string
  /**
   * Repo-relative directory of the active Workspace, e.g.
   * "workspaces/marketing-automation". When set, the agent runs with its cwd
   * here instead of at the clone root, which is what makes Claude Code discover
   * both `<path>/.claude/skills/` and the repo-root `.claude/skills/` (skill
   * lookup walks from cwd up to the repo root). Undefined = run at the root.
   */
  workspacePath?: string | null
  /** The Workspace's own system prompt, appended after the platform rules. */
  workspaceSystemPrompt?: string | null
  previewUrlPattern?: string
  sessionId?: string
  agent?: Agent
  model?: string
  env?: Record<string, string>
  /** When true, agent should plan before acting */
  planMode?: boolean
  /**
   * Discovered skills to inject as a structured catalog in the system prompt.
   * Populated by scanning .agents/skills/ after install.
   */
  skills?: SkillCatalogEntry[]
  /**
   * MCP servers to expose to the agent. The web layer fetches these from
   * `ChatMcpServer` and decrypts the per-row Smithery API key before passing
   * them in — this module stays generic and doesn't touch the DB.
   */
  mcpServers?: AgentMcpServer[]
}

// =============================================================================
// Background Session
// =============================================================================

export interface BackgroundStartOptions {
  /** Previous conversation history to inject as context (e.g., on agent switch). */
  history?: readonly { role: "user" | "assistant"; content: string }[]
}

export interface BackgroundAgentSession {
  backgroundSessionId: string
  start: (prompt: string, options?: BackgroundStartOptions) => Promise<void>
}

/**
 * Resolve the directory the agent actually runs in.
 *
 * `repoPath` is the clone root; a workspace narrows the cwd to a subdirectory of
 * it. We re-validate the path here even though it is validated on write: it is
 * interpolated into a sandbox shell cwd, and a bad value could place an agent
 * holding real credentials somewhere unintended. That is worth failing loudly at
 * spin-up rather than discovering mid-task.
 */
function resolveWorkspace(
  options: AgentSessionOptions
): { dir: string; prompt?: string | null } | undefined {
  const path = options.workspacePath
  if (!path) return undefined
  if (!isSafeWorkspacePath(path)) {
    throw new Error(
      `Refusing to start agent: unsafe Workspace.path ${JSON.stringify(path)}`
    )
  }
  return {
    dir: `${options.repoPath}/${path}`,
    prompt: options.workspaceSystemPrompt,
  }
}

export async function createBackgroundAgentSession(
  sandbox: DaytonaSandbox,
  options: AgentSessionOptions
): Promise<BackgroundAgentSession> {
  const workspace = resolveWorkspace(options)
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern,
    options.skills,
    workspace
  )

  // Map agent type to SDK provider name
  const agent = options.agent || "opencode"
  const provider = agentToProvider[agent] || "opencode"

  // Set up git safety hooks based on agent type
  // This blocks dangerous git operations (push, rebase, reset --hard, etc.)
  if (agent === "claude-code") {
    await setupClaudePermissions(sandbox, DEFAULT_GIT_POLICY)
  } else if (agent === "codex") {
    await setupCodexPermissions(sandbox, DEFAULT_GIT_POLICY)
  }

  // Write per-agent MCP config files for the connected MCP servers.
  // Must run before createSession() so the CLI loads them on spawn.
  // Always call — even with an empty list — so that disconnecting the last
  // server overwrites the previous on-disk config in a reused sandbox. Skipping
  // the call here would leave stale entries the agent CLI still loads.
  if (options.mcpServers) {
    try {
      await setupMcpForAgent(sandbox, {
        agent,
        servers: options.mcpServers,
      })
    } catch (err) {
      // MCP setup is best-effort — a failure here shouldn't block the turn.
      console.error("[agent-session] setupMcpForAgent failed:", err)
    }
  }

  // For OpenCode in non-plan mode, inject default permission rules via environment variable
  // (Plan mode permissions are handled by the agent's buildCommand)
  const env = { ...options.env }
  if (agent === "opencode" && !options.planMode) {
    env.OPENCODE_PERMISSION = renderOpenCodePermissionEnv(DEFAULT_GIT_POLICY)
  }

  const bgSession = await createSession(provider, {
    sandbox,
    systemPrompt,
    sessionId: options.sessionId,
    // The agent runs in the workspace folder; git still targets the clone root.
    cwd: workspace?.dir ?? options.repoPath,
    model: options.model,
    env: Object.keys(env).length > 0 ? env : undefined,
    planMode: options.planMode,
  })

  return {
    backgroundSessionId: bgSession.id,
    async start(prompt: string, options?: BackgroundStartOptions) {
      await bgSession.start(prompt, {
        ...(options?.history?.length && { history: options.history }),
      })
    },
  }
}

/**
 * Rehydrate an existing background session handle. Every read/control entry
 * point below (finalize, cancel, snapshot) needs the same thing: rebuild the
 * system prompt from the session options and re-attach to the running session.
 * Centralized here so the prompt-build arguments stay in sync across callers.
 */
async function getBackgroundSession(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
) {
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern,
    options.skills,
    resolveWorkspace(options)
  )
  return getSession(backgroundSessionId, { sandbox, systemPrompt })
}

// =============================================================================
// Polling
// =============================================================================

/**
 * Cumulative snapshot of an agent session at a point in time.
 * Source of truth: the event log file in the sandbox.
 */
export interface AgentSnapshot {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
  error?: string
  /** When status is "error", classifies the failure so the UI can pick the
   *  right recovery action. "crash" = the agent process exited without
   *  completing (often transient, and any partial turn may have been persisted
   *  server-side) → the UI may offer Reload instead of Retry. "incomplete" = the
   *  wire stream ended with no terminal event and no output → the agent may still
   *  be running in the background, so the UI offers Reload (refresh history)
   *  rather than resending. Specific failures that carry their own guidance (e.g.
   *  model-not-available) stay undefined. */
  errorKind?: "crash" | "incomplete"
  sessionId?: string
}

/**
 * Derive {content, toolCalls, contentBlocks, status, error} from a list of
 * events. Pass cumulative events to get a cumulative summary; pass deltas to
 * get a delta summary.
 */
function summarizeEvents(
  events: Event[],
  running: boolean,
  sessionId: string | null
): AgentSnapshot {
  const { content, toolCalls, contentBlocks } = buildContentBlocks(events)

  const crashEvent = events.find(
    (e) => (e as { type: string }).type === "agent_crashed"
  ) as { type: "agent_crashed"; message?: string; output?: string } | undefined
  if (crashEvent) {
    const baseMsg = crashEvent.message ?? "Process exited without completing"
    // The wrapper captures the agent process's last ~4KB of non-JSON
    // stdout/stderr in `output`. That's where the actual reason (auth
    // failure, missing binary, panic, etc.) lives — surface it.
    const error = crashEvent.output
      ? `${baseMsg}\n\n${crashEvent.output}`
      : baseMsg
    // A bare process crash ("exited without completing") is often transient and
    // its partial turn may already be persisted, so tag it "crash" → the UI can
    // offer Reload. Synthesized crashes with a specific cause (e.g.
    // model-not-available) get a tailored message and stay a plain error → Retry.
    const errorKind = /exited without completing/i.test(baseMsg)
      ? ("crash" as const)
      : undefined
    return {
      status: "error",
      content,
      toolCalls,
      contentBlocks,
      error,
      errorKind,
      sessionId: sessionId || undefined,
    }
  }

  const endEvent = events.find((e): e is EndEvent => e.type === "end") as
    | (EndEvent & { error?: string })
    | undefined

  if (endEvent?.error) {
    return {
      status: "error",
      content,
      toolCalls,
      contentBlocks,
      error: endEvent.error,
      sessionId: sessionId || undefined,
    }
  }

  const isCompleted = !!endEvent

  if (!running && !endEvent) {
    const hasOutput = !!content?.trim() || toolCalls.length > 0
    return {
      status: hasOutput ? "completed" : "error",
      content,
      toolCalls,
      contentBlocks,
      error: hasOutput ? undefined : "Agent stopped without completing",
      // The agent may still be running in the background; refreshing the chat
      // history recovers the turn rather than resending and duplicating it.
      errorKind: hasOutput ? undefined : ("incomplete" as const),
      sessionId: sessionId || undefined,
    }
  }

  return {
    status: isCompleted ? "completed" : "running",
    content,
    toolCalls,
    contentBlocks,
    sessionId: sessionId || undefined,
  }
}

/**
 * Advance the bg session's per-turn meta after a turn has completed by
 * triggering one getEvents() call. snapshotBackgroundAgent is read-only and
 * doesn't perform this bookkeeping; without it, the next start() in the
 * same session would write to the just-finished turn's outputFile.
 *
 * Best-effort: errors are swallowed because the snapshot has already been
 * persisted to the DB and the wire state has settled.
 */
export async function finalizeTurn(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<void> {
  try {
    const bgSession = await getBackgroundSession(
      sandbox,
      backgroundSessionId,
      options
    )
    await bgSession.getEvents()
  } catch {
    /* best effort */
  }
}

/**
 * Cancel a running background agent by killing its process.
 * Called when the user clicks "Stop" to terminate the agent.
 */
export async function cancelBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<void> {
  try {
    const bgSession = await getBackgroundSession(
      sandbox,
      backgroundSessionId,
      options
    )

    await bgSession.cancel()
  } catch (err) {
    console.error("[cancelBackgroundAgent] Error:", err)
    // Don't rethrow - cancellation is best-effort
  }
}

/**
 * Read cumulative state by re-parsing the entire event log on disk in the
 * sandbox. Use on connect, on reconnect, and for any persistence write
 * where you need the full snapshot. Does not advance the session's cursor.
 */
export async function snapshotBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<AgentSnapshot> {
  try {
    const bgSession = await getBackgroundSession(
      sandbox,
      backgroundSessionId,
      options
    )

    const result = (await bgSession.getSnapshot()) as {
      events: Event[]
      sessionId: string | null
      cursor: string
      running?: boolean
    }

    const running =
      typeof result.running === "boolean"
        ? result.running
        : await bgSession.isRunning()

    return summarizeEvents(result.events, running, result.sessionId)
  } catch (err) {
    console.error("[snapshotBackgroundAgent] Error:", err)
    return {
      status: "error",
      content: "",
      toolCalls: [],
      contentBlocks: [],
      error: formatAgentError(err),
    }
  }
}
