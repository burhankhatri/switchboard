/**
 * Sandbox orchestration helpers.
 *
 * Pulled out of the legacy /api/sandbox/* routes so the new
 * /api/chats/[chatId]/messages endpoint can drive sandbox lifecycle
 * directly without duplicating the bring-up sequence.
 */

import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { createSandboxGit, withAuth } from "@switchboard/sandbox-git"
import { installSkills, discoverInstalledSkills } from "@switchboard/sandbox-skills/sandbox"
import { TOKSCALE_VERSION, getActiveSnapshotName } from "@switchboard/sandbox-image"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"

/**
 * Sandbox ids we've already confirmed have tokscale this process lifetime, so
 * we skip the `which`/install probe on subsequent bring-ups of the same
 * sandbox. Best-effort: a cold serverless invocation just re-probes (cheap).
 */
const tokscaleReady = new Set<string>()

/**
 * Ensure tokscale (post-turn token/cost metering CLI) is on PATH in the
 * sandbox, installing it on demand.
 *
 * The snapshot pre-installs tokscale (see TOKSCALE_VERSION in
 * @switchboard/sandbox-image), but sandboxes created BEFORE that snapshot
 * bump won't have it. We probe once per sandbox at bring-up and `npm install
 * -g` it if missing, so metering works on long-lived pre-existing sandboxes
 * too. Best-effort: never throws — a failure just means that turn isn't metered.
 */
async function ensureTokscaleInstalled(sandbox: Sandbox): Promise<void> {
  const id = sandbox.id
  if (id && tokscaleReady.has(id)) return

  try {
    const probe = await sandbox.process.executeCommand(
      "which tokscale",
      undefined,
      undefined,
      15
    )
    if ((probe.exitCode ?? 1) === 0) {
      if (id) tokscaleReady.add(id)
      return
    }
  } catch {
    // fall through to install attempt
  }

  console.log(
    `[sandbox] tokscale missing in ${id ?? "?"}; installing tokscale@${TOKSCALE_VERSION}`
  )
  try {
    // Global installs land in root-owned /usr/local/lib; the sandbox runs as the
    // non-root `daytona` user, so we need sudo (granted NOPASSWD in the image).
    const install = await sandbox.process.executeCommand(
      `sudo npm install -g tokscale@${TOKSCALE_VERSION}`,
      undefined,
      undefined,
      180
    )
    if ((install.exitCode ?? 1) !== 0) {
      console.warn(
        `[sandbox] tokscale install failed in ${id ?? "?"}:`,
        (install.result ?? "").slice(0, 300)
      )
      return
    }
    if (id) tokscaleReady.add(id)
  } catch (err) {
    console.warn(`[sandbox] tokscale install threw in ${id ?? "?"}:`, err)
  }
}

/**
 * Ensure a sandbox is in the "started" state, handling the race condition
 * where multiple concurrent requests try to start the same sandbox.
 *
 * If the sandbox is already starting (409 Conflict), retries with backoff
 * until the start succeeds or times out.
 */
export async function ensureSandboxStarted(
  sandbox: Sandbox,
  timeoutSeconds = 120
): Promise<void> {
  if (sandbox.state === "started") {
    // Already warm — still make sure tokscale is present (covers sandboxes
    // created before tokscale was added to the snapshot). Cached per sandbox.
    await ensureTokscaleInstalled(sandbox)
    return
  }

  const maxAttempts = 5
  const baseDelayMs = 500

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await sandbox.start(timeoutSeconds)
      await ensureTokscaleInstalled(sandbox)
      return
    } catch (err: unknown) {
      // Handle race condition: another request is already starting this sandbox
      const isConflict =
        err instanceof Error &&
        ((err as { statusCode?: number }).statusCode === 409 ||
          err.message.includes("state change in progress"))

      if (!isConflict) throw err

      // Last attempt - give up
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `Sandbox failed to start after ${maxAttempts} attempts (state change in progress)`
        )
      }

      // Exponential backoff: 500ms, 1s, 2s, 4s
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

export interface CreateSandboxOptions {
  daytona: Daytona
  /** "owner/repo" string, or NEW_REPOSITORY for a brand-new local repo. */
  repo: string
  baseBranch: string
  newBranch: string
  /** Required for non-NEW_REPOSITORY repos. Used for clone + push. */
  githubToken?: string
  /**
   * The user's own GitHub token, used only to look up who commits are authored
   * as. Differs from `githubToken` when a workspace run clones with the shared
   * service token — without it every member's commits would carry the service
   * account's name.
   */
  identityToken?: string
  /**
   * Repo-relative paths to check out instead of the whole repo; see
   * workspaceSparsePaths. Omitted means a full clone.
   */
  sparsePaths?: string[]
  /** First 8 chars are used in the sandbox name for traceability. */
  userId?: string
  /**
   * If true, attempt to restore an existing branch from remote instead of
   * creating a fresh one. Used when recreating a deleted sandbox.
   */
  restoreExistingBranch?: boolean
  /**
   * Launch from this snapshot instead of the active one. Only the skill harness
   * sets it, to check a freshly built image before a rebuild makes it live.
   */
  snapshot?: string
}

export interface CreatedSandbox {
  sandbox: Awaited<ReturnType<Daytona["create"]>>
  sandboxId: string
  branch: string
  previewUrlPattern: string | undefined
  /** Always "project" in this repo, but returned so callers can plumb it through. */
  repoName: string
  /**
   * When restoreExistingBranch is true, indicates whether the branch was
   * successfully fetched from remote (true) or created fresh (false).
   */
  branchRestored?: boolean
}

function generateSandboxName(userId?: string): string {
  const uuid = randomUUID().split("-")[0]
  const userIdPrefix = userId ? userId.slice(0, 8) : "anon"
  return `switchboard-${userIdPrefix}-${uuid}`
}

/**
 * Create a Daytona sandbox and prepare it for an agent run: clone the repo
 * (or git-init for NEW_REPOSITORY), set up author config, create the working
 * branch, and look up the preview URL pattern.
 */
export async function createSandboxForChat(
  options: CreateSandboxOptions
): Promise<CreatedSandbox> {
  const {
    daytona,
    repo,
    baseBranch,
    newBranch,
    githubToken,
    identityToken,
    sparsePaths,
    userId,
    restoreExistingBranch,
    snapshot,
  } = options
  const isNewRepo = repo === NEW_REPOSITORY || repo === "__new__"
  const repoName = "project"
  let branchRestored: boolean | undefined

  let owner: string | undefined
  let repoApiName: string | undefined
  if (!isNewRepo) {
    if (!githubToken) {
      throw new Error("githubToken required for non-NEW_REPOSITORY chats")
    }
    const parts = repo.split("/")
    owner = parts[0]
    repoApiName = parts[1]
    if (!owner || !repoApiName) {
      throw new Error("Invalid repo format")
    }
  }

  const sandbox = await daytona.create({
    name: generateSandboxName(userId),
    snapshot: snapshot ?? (await getActiveSnapshotName(daytona)),
    autoStopInterval: 5,
    // Archive an hour after it stops. Archiving moves the filesystem to cold
    // storage and releases the disk, and the sandbox still starts again on the
    // next message — so this costs a slower resume and buys the quota back.
    //
    // Without it the SDK default is SEVEN DAYS, and every chat holds 5GiB for
    // that whole time. Six chats in a day is a 30GiB org limit exhausted, which
    // presents as "Total disk limit exceeded" on an unrelated new chat.
    autoArchiveInterval: 60,
    // Daytona caps the org at six sandboxes, stopped ones included, so a chat
    // idle past autoStopInterval is deleted outright (0 = delete on stop). The
    // branch is pushed after every turn and the next message recreates the
    // sandbox from it; work the agent left uncommitted is lost by design.
    //
    // A NEW_REPOSITORY chat has no remote to rebuild from — the sandbox IS the
    // repository — so it keeps four days before deletion.
    autoDeleteInterval: isNewRepo ? 5760 : 0,
    public: true,
    labels: {
      [SANDBOX_CONFIG.LABEL_KEY]: "true",
      repo: isNewRepo ? NEW_REPOSITORY : `${owner}/${repoApiName}`,
      branch: newBranch,
    },
  })

  const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

  // Not awaited in sequence: nothing below needs the logs directory to exist,
  // and the agent process creates its own log files later.
  const logsDir = sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

  if (isNewRepo) {
    // One exec, not five. Every executeCommand is a round trip to the sandbox
    // and a process spawn; these commands are plain shell with no branching, so
    // there is nothing to be gained from issuing them separately.
    await sandbox.process.executeCommand(
      [
        `mkdir -p ${repoPath}`,
        `cd ${repoPath}`,
        "git init",
        'git config user.email "agent@simplechat.dev"',
        'git config user.name "Simple Chat Agent"',
        'echo "# Project" > README.md',
        "git add .",
        'git commit -m "Initial commit"',
        `git checkout -b ${newBranch}`,
      ].join(" && ")
    )
  } else {
    const cloneUrl = `https://github.com/${owner}/${repoApiName}.git`
    const git = createSandboxGit(sandbox)

    // Started before the clone rather than after it: this is a call to
    // api.github.com that the clone does not depend on, so awaiting it in
    // sequence just added its latency to spin-up. Kicked off here, collected
    // below.
    const identity = fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${identityToken ?? githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
      .then(async (res) => (res.ok ? await res.json() : null))
      .catch(() => null)

    if (sparsePaths?.length) {
      await git.cloneSparse(cloneUrl, repoPath, sparsePaths, baseBranch, githubToken!)
    } else {
      await git.clone(cloneUrl, repoPath, baseBranch, undefined, githubToken!)
    }

    let gitName = "Simple Chat Agent"
    let gitEmail = "noreply@example.com"
    const ghUser = await identity
    if (ghUser) {
      gitName = ghUser.name || ghUser.login
      gitEmail = `${ghUser.login}@users.noreply.github.com`
    }

    // Branch setup: either restore existing branch from remote or create new.
    //
    // Both checkouts are checked, not fire-and-forget: executeCommand does not
    // throw on a non-zero exit, and auto-push pushes `origin HEAD`. A checkout
    // that failed silently left HEAD on the base branch, so the agent's next
    // commits would have been pushed straight to it.
    const setAuthor = `git config user.email "${gitEmail}" && git config user.name "${gitName}"`
    const checkout = async (cmd: string) => {
      const res = await sandbox.process.executeCommand(`cd ${repoPath} && ${setAuthor} && ${cmd}`)
      if (res.exitCode !== 0) {
        throw new Error(`Could not check out ${newBranch}: ${res.result.trim()}`)
      }
    }

    let remoteBranchExists = false
    if (restoreExistingBranch) {
      try {
        await git.fetchBranch(repoPath, newBranch, githubToken!)
        remoteBranchExists = true
      } catch {
        // Branch doesn't exist on remote; create it fresh from baseBranch below.
      }
    }

    if (remoteBranchExists) {
      // The checkout carries the token: in a sparse (partial) clone the
      // branch's file contents are downloaded lazily on checkout, and that
      // download needs credentials. The start point is named explicitly: the
      // clone is --single-branch, so git's "checkout <name> guesses the remote
      // branch" shortcut does not apply and a bare name fails with "pathspec
      // did not match".
      await checkout(withAuth(githubToken!, `checkout -B ${newBranch} origin/${newBranch} 2>&1`))
      branchRestored = true
    } else {
      await checkout(`git checkout -b ${newBranch} 2>&1`)
      if (restoreExistingBranch) branchRestored = false
    }
  }

  await logsDir

  let previewUrlPattern: string | undefined
  try {
    const previewLink = await sandbox.getPreviewLink(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
    previewUrlPattern = previewLink.url.replace(
      String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT),
      "{port}"
    )
  } catch {
    /* preview URLs not available */
  }

  return {
    sandbox,
    sandboxId: sandbox.id,
    branch: newBranch,
    previewUrlPattern,
    repoName,
    branchRestored,
  }
}

/**
 * Upload files to an existing sandbox under destDir, resolving filename
 * conflicts with -1, -2, …, -timestamp suffixes. The directory is created if
 * it doesn't exist. Returns the destination paths.
 */
export async function uploadFilesToSandbox(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  destDir: string,
  files: File[]
): Promise<string[]> {
  await sandbox.process.executeCommand(`mkdir -p '${destDir}'`)
  const paths: string[] = []
  for (const file of files) {
    const resolvedName = await resolveFilename(sandbox, destDir, file.name)
    const destPath = `${destDir}/${resolvedName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await sandbox.fs.uploadFile(buffer, destPath)
    paths.push(destPath)
  }
  return paths
}

async function resolveFilename(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  destDir: string,
  filename: string
): Promise<string> {
  if (!(await fileExists(sandbox, `${destDir}/${filename}`))) return filename

  const lastDot = filename.lastIndexOf(".")
  const hasExt = lastDot > 0
  const base = hasExt ? filename.slice(0, lastDot) : filename
  const ext = hasExt ? filename.slice(lastDot) : ""

  for (let counter = 1; counter < 100; counter++) {
    const candidate = `${base}-${counter}${ext}`
    if (!(await fileExists(sandbox, `${destDir}/${candidate}`))) return candidate
  }
  return `${base}-${Date.now()}${ext}`
}

async function fileExists(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  path: string
): Promise<boolean> {
  try {
    const result = await sandbox.process.executeCommand(`test -e "${path}" && echo "exists"`)
    return result.result?.trim() === "exists"
  } catch {
    return false
  }
}

/**
 * Best-effort sandbox deletion used in the failure path of message
 * orchestration. Errors are swallowed because they're already happening
 * inside another error handler.
 */
export async function deleteSandboxQuietly(
  daytona: Daytona,
  sandboxId: string
): Promise<void> {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()
  } catch (err) {
    console.error("[sandbox] Failed to delete sandbox:", sandboxId, err)
  }
}

/**
 * Discover installed skills in a sandbox for a given repo path.
 *
 * Scans .agents/skills/ and parses SKILL.md frontmatter for each installed
 * skill. Returns a catalog suitable for injection into the system prompt.
 * Best-effort — returns an empty array on any error.
 */
export async function discoverSkillsForRepo(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string
): Promise<{ name: string; description: string; location: string }[]> {
  try {
    const skills = await discoverInstalledSkills(sandbox, repoPath)
    if (skills.length > 0) {
      console.log(`[sandbox] Discovered ${skills.length} skill(s) in ${repoPath}`)
    }
    return skills
  } catch (err) {
    console.error("[sandbox] discoverSkillsForRepo failed:", err)
    return []
  }
}

/**
 * Install all repo-scoped skills into a sandbox.
 *
 * Called during sandbox creation/restoration to ensure skills are present
 * before the agent starts. Pre-validates each skill via --list to avoid
 * installing stale/renamed skills. Best-effort — individual failures are
 * logged but don't abort the overall sandbox setup.
 */
export async function installSkillsForRepo(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  userId: string,
  repo: string
): Promise<{ installed: number; total: number }> {

  const skills = await prisma.skill.findMany({
    where: { userId, repo },
    orderBy: { createdAt: "asc" },
  })

  if (skills.length === 0) return { installed: 0, total: 0 }

  const repoPath = `${PATHS.SANDBOX_HOME}/project`

  const result = await installSkills(
    sandbox,
    repoPath,
    skills.map((s) => ({ id: s.id, fullHandle: s.fullHandle })),
    async (id) => {
      console.warn(`[sandbox] Removing stale skill DB record: ${id}`)
      await prisma.skill.delete({ where: { id } }).catch(() => {})
    }
  )

  if (result.installed > 0) {
    console.log(
      `[sandbox] Installed ${result.installed}/${result.total} skills for ${repo}`
    )
  }

  return { installed: result.installed, total: result.total }
}
