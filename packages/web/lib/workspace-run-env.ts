import { prisma } from "@/lib/db/prisma"
import { decryptWorkspaceEnv, type WorkspaceRuntime } from "@/lib/workspace"
import { restConnectionEnv } from "@/lib/workspace-connections"

/** What a workspace has to carry for its credentials to be resolvable. */
export type WorkspaceEnvSource = Pick<
  WorkspaceRuntime,
  "slug" | "environmentVariables" | "connections"
>

export class WorkspaceMembershipRevoked extends Error {
  constructor() {
    super("You are no longer a member of this workspace, so its connections were not loaded.")
    this.name = "WorkspaceMembershipRevoked"
  }
}

/**
 * The workspace's contribution to a run's environment: its own variables plus
 * its REST connections, decrypted.
 *
 * Membership is re-checked on EVERY run, not just when the chat or job was
 * bound to the workspace. A binding lasts for the life of the row, so without
 * this, leaving a workspace would revoke nothing — the next run would still be
 * handed the current credential, including one rotated in after the person
 * left.
 *
 * Shared by the interactive and scheduled paths deliberately. They already
 * resolve the workspace identically; two copies of an authorization check is
 * how one of them ends up a version behind.
 *
 * Throws rather than returning empty: a run that quietly proceeds without the
 * credential fails later, somewhere less obvious, and possibly after doing
 * half the work.
 */
export async function workspaceRunEnv(params: {
  workspaceId: string | null | undefined
  workspace: WorkspaceEnvSource | null | undefined
  userId: string
}): Promise<Record<string, string>> {
  const { workspaceId, workspace, userId } = params
  if (!workspaceId) return {}

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!member) throw new WorkspaceMembershipRevoked()

  // Throws if a value cannot be decrypted, so a broken connection fails at
  // spin-up rather than mid-task or by sending garbage to the CRM as a key.
  // REST connections merge in with the workspace's own variables: both are
  // workspace-owned, so neither may be shadowed by a user's own vars.
  return {
    ...decryptWorkspaceEnv(workspace),
    ...restConnectionEnv(workspace?.connections ?? [], workspace?.slug ?? "workspace"),
  }
}
