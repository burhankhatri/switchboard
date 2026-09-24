import { prisma } from "@/lib/db/prisma"
import { chooseGitToken, isWorkspacesRepo } from "@/lib/workspace-repo"

/**
 * Resolve the git token for a run: the workspaces service token when `userId` is
 * a member of the run's workspace and that workspace lives in the workspaces
 * repo, otherwise `userToken`.
 *
 * Membership is re-read here rather than trusted from the chat row, because a
 * member removed from a workspace keeps their old chats — and those chats must
 * stop cloning the shared repo the moment the membership row is gone.
 */
export async function gitTokenForRun(params: {
  userId: string
  repo: string
  workspaceId: string | null | undefined
  userToken: string | null
}): Promise<string | null> {
  const { userId, repo, workspaceId, userToken } = params
  // Skips the lookup on the common path: a chat on the user's own repo.
  if (!workspaceId || !isWorkspacesRepo(repo)) return userToken

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { workspace: { select: { repo: true } } },
  })
  return chooseGitToken({
    repo,
    isWorkspaceMember: !!membership && isWorkspacesRepo(membership.workspace.repo),
    userToken,
  })
}
