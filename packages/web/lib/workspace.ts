import { decryptSecret } from "@/lib/db/encryption"

/**
 * Workspace runtime resolution.
 *
 * A Workspace is a folder in a git repo carrying the skills, scripts and
 * connection names for one kind of work. At run time we only need enough of the
 * row to clone the right repo, place the agent's cwd inside the right folder,
 * and pick the harness — so that subset is defined once here and reused by both
 * entry points (interactive chat and scheduled jobs) rather than duplicated.
 */

/** Prisma `select` for the fields a run actually needs. */
export const WORKSPACE_RUNTIME_SELECT = {
  id: true,
  slug: true,
  name: true,
  repo: true,
  path: true,
  baseBranch: true,
  agent: true,
  model: true,
  systemPrompt: true,
  environmentVariables: true,
} as const

export interface WorkspaceRuntime {
  id: string
  slug: string
  name: string
  repo: string
  path: string
  baseBranch: string
  agent: string
  model: string | null
  systemPrompt: string | null
  environmentVariables: unknown
}

/**
 * The subset of AgentSessionOptions a workspace contributes.
 *
 * Returns an empty object for a null workspace so callers can spread this
 * unconditionally — a chat with no workspace keeps running at the clone root,
 * which is the pre-workspace behaviour.
 */
export function workspaceSessionOptions(
  workspace: Pick<WorkspaceRuntime, "path" | "systemPrompt"> | null | undefined
): { workspacePath?: string; workspaceSystemPrompt?: string } {
  if (!workspace) return {}
  return {
    workspacePath: workspace.path,
    ...(workspace.systemPrompt ? { workspaceSystemPrompt: workspace.systemPrompt } : {}),
  }
}

/**
 * Which repo a run should clone: the workspace's, falling back to the chat's own
 * `repo`/`baseBranch` for chats created before workspaces existed.
 */
export function resolveRunRepo(
  workspace: Pick<WorkspaceRuntime, "repo" | "baseBranch"> | null | undefined,
  fallback: { repo: string; baseBranch: string }
): { repo: string; baseBranch: string } {
  if (!workspace) return fallback
  return { repo: workspace.repo, baseBranch: workspace.baseBranch }
}

/**
 * Decrypt a workspace's connection values for injection into a sandbox.
 *
 * Throws if any value fails to decrypt: a workspace that cannot supply its
 * connections should fail at spin-up, loudly, rather than start an agent that
 * will discover it halfway through a task — or send a ciphertext string to the
 * CRM as a credential.
 */
export function decryptWorkspaceEnv(
  workspace: Pick<WorkspaceRuntime, "slug" | "environmentVariables"> | null | undefined
): Record<string, string> {
  if (!workspace?.environmentVariables) return {}
  const stored = workspace.environmentVariables as Record<string, string>
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (!value) continue
    out[key] = decryptSecret(value, `${workspace.slug}.${key}`)
  }
  return out
}

/** Key names only — values must never reach a client. */
export function workspaceEnvKeys(
  workspace: Pick<WorkspaceRuntime, "environmentVariables"> | null | undefined
): string[] {
  if (!workspace?.environmentVariables) return []
  return Object.keys(workspace.environmentVariables as Record<string, string>).sort()
}

/** Env var names we accept. Rejects lowercase and anything shell-unsafe. */
export function isValidEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(name)
}
