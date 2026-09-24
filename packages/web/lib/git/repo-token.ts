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
export async function gitTokenForRun<T extends string | null>(params: {
  userId: string
  repo: string
  workspaceId: string | null | undefined
  userToken: T
}): Promise<string | T> {
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

/**
 * The token for a GitHub call a member makes by hand (branches, compare, PR,
 * merge, squash) against `repo`, where there is no single run to tie it to.
 *
 * Every workspace shares the one repo, so membership of any workspace in it is
 * the bar — the same bar the file routes apply before writing to it.
 */
export async function gitTokenForRepo<T extends string | null>(params: {
  userId: string
  repo: string
  userToken: T
}): Promise<string | T> {
  const { userId, repo, userToken } = params
  if (!isWorkspacesRepo(repo)) return userToken

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { repo: { equals: repo, mode: "insensitive" } } },
    select: { id: true },
  })
  return chooseGitToken({ repo, isWorkspaceMember: !!membership, userToken })
}

/**
 * The token for git run inside a sandbox the caller owns, resolved from the
 * chat or scheduled run that sandbox belongs to.
 */
export async function gitTokenForSandbox<T extends string | null>(params: {
  userId: string
  sandboxId: string
  userToken: T
}): Promise<string | T> {
  const { userId, sandboxId, userToken } = params
  const [chat, run] = await Promise.all([
    prisma.chat.findFirst({
      where: { sandboxId, userId },
      select: { repo: true, workspaceId: true },
    }),
    prisma.scheduledJobRun.findFirst({
      where: { sandboxId, job: { userId } },
      select: { job: { select: { repo: true, workspaceId: true } } },
    }),
  ])
  const owner = chat ?? run?.job
  if (!owner) return userToken
  return gitTokenForRun({ userId, repo: owner.repo, workspaceId: owner.workspaceId, userToken })
}
