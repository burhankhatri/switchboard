import type { SandboxLike } from "@switchboard/sandbox-git"
import { docOnlyMergeDecision } from "./doc-only-merge"

/**
 * Land an agent branch on the workspace's base branch when it changed nothing
 * but documentation. See doc-only-merge.ts for which paths qualify and why.
 *
 * The merge is done by GitHub, not in the sandbox: the sandbox is on the agent
 * branch and must stay there, and a push to main from inside it would need a
 * second checkout and a token with the same rights anyway. GitHub's merges API
 * is one request and refuses conflicts, which is the behaviour wanted.
 */
export type AutoMergeResult = { merged: true; files: number } | { merged: false; reason: string }

export interface AutoMergeParams {
  sandbox: SandboxLike
  repoPath: string
  /** "owner/name" */
  repo: string
  branch: string
  baseBranch: string
  workspacePath: string
  token: string
}

export async function mergeDocOnlyBranch(
  params: AutoMergeParams,
  fetchImpl: typeof fetch = fetch
): Promise<AutoMergeResult> {
  const { sandbox, repoPath, repo, branch, baseBranch, workspacePath, token } = params

  // Three dots: what the merge would bring, not what differs between the tips.
  const diff = await sandbox.process.executeCommand(
    `cd ${repoPath} && git fetch -q origin ${baseBranch} 2>/dev/null; ` +
      `git diff --name-status origin/${baseBranch}...HEAD 2>/dev/null`
  )
  const decision = docOnlyMergeDecision(diff.result.split("\n"), workspacePath)
  if (!decision.merge) return { merged: false, reason: decision.reason }

  const res = await fetchImpl(`https://api.github.com/repos/${repo}/merges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base: baseBranch,
      head: branch,
      commit_message: `Merge ${branch}: ${decision.files} documentation change${decision.files === 1 ? "" : "s"} from an agent`,
    }),
  })

  if (res.status === 201) return { merged: true, files: decision.files }
  if (res.status === 204) return { merged: false, reason: "already up to date" }
  let detail = ""
  try {
    detail = ((await res.json()) as { message?: string }).message ?? ""
  } catch {
    // no body
  }
  return { merged: false, reason: `GitHub refused the merge (${res.status}${detail ? `: ${detail}` : ""})` }
}
