/**
 * The GitHub side of a workspace.
 *
 * Every workspace is a folder in ONE private repo (WORKSPACES_REPO). Creating a
 * workspace ensures that repo exists and commits a scaffold folder into it;
 * running a workspace sparse-clones just that folder. Keeping it to one repo is
 * what makes "join a workspace" a database row rather than a GitHub collaborator
 * invite, and what lets shared skills live at the repo root.
 */

const GH = "https://api.github.com"

export const WORKSPACES_REPO = process.env.WORKSPACES_REPO ?? ""

/**
 * GitHub call with bounded retry on transient failures.
 *
 * Creating a workspace is several writes; a 5xx partway through would otherwise
 * leave a half-scaffolded folder and no row. Retrying is safe because putFile()
 * skips paths that already exist, so a retried scaffold heals a partial one
 * rather than duplicating or clobbering it.
 *
 * Retries 5xx and 429 only. A 4xx is our bug or a permissions problem and
 * repeating it just delays the error.
 */
async function ghFetch(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let last: Response | null = null
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init)
    if (res.status < 500 && res.status !== 429) return res
    last = res
    if (i < attempts - 1) {
      // 400ms, 800ms, 1600ms — short enough to stay inside a request, long
      // enough to clear a brief upstream blip.
      await new Promise((r) => setTimeout(r, 400 * 2 ** i))
    }
  }
  return last as Response
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
}

/** Lowercase, hyphenated, and safe to interpolate into a sandbox path. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/**
 * Ensure the private workspaces repo exists, creating it on first use.
 *
 * `auto_init` matters: the Contents API cannot write into a repo with no
 * default branch, so an empty repo would fail on the very next call.
 */
export async function ensureWorkspacesRepo(token: string): Promise<void> {
  if (!WORKSPACES_REPO) throw new Error("WORKSPACES_REPO is not set")
  const [owner, repo] = WORKSPACES_REPO.split("/")
  if (!owner || !repo) throw new Error(`malformed WORKSPACES_REPO: ${WORKSPACES_REPO}`)

  const existing = await ghFetch(`${GH}/repos/${owner}/${repo}`, { headers: headers(token) })
  if (existing.ok) return
  if (existing.status !== 404) {
    throw new Error(`GitHub ${existing.status} checking ${WORKSPACES_REPO}: ${await existing.text()}`)
  }

  const created = await ghFetch(`${GH}/user/repos`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      name: repo,
      private: true,
      auto_init: true,
      description: "Agent workspaces — one folder per workspace.",
    }),
  })
  if (!created.ok) {
    throw new Error(`Could not create ${WORKSPACES_REPO}: ${created.status} ${await created.text()}`)
  }
}

/** Write one file. Returns false if the path already exists (never clobbers). */
async function putFile(
  token: string,
  path: string,
  content: string,
  message: string
): Promise<boolean> {
  const [owner, repo] = WORKSPACES_REPO.split("/")
  const url = `${GH}/repos/${owner}/${repo}/contents/${path}`

  const head = await ghFetch(url, { headers: headers(token) })
  if (head.ok) return false

  const res = await ghFetch(url, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  })
  if (!res.ok) {
    throw new Error(`Could not write ${path}: ${res.status} ${await res.text()}`)
  }
  return true
}

export interface ScaffoldInput {
  slug: string
  name: string
  systemPrompt?: string | null
  agent: string
  env: string[]
}

/**
 * Commit a workspace folder: its config plus one starter skill, so a brand new
 * workspace has something for skill discovery to find on its first run rather
 * than looking broken.
 */
export async function scaffoldWorkspace(
  token: string,
  input: ScaffoldInput
): Promise<{ path: string; created: string[] }> {
  const path = `workspaces/${input.slug}`
  const created: string[] = []

  const yaml = [
    `name: ${JSON.stringify(input.name)}`,
    `agent: ${input.agent}`,
    input.systemPrompt?.trim()
      ? `systemPrompt: |\n${input.systemPrompt.trim().split("\n").map((l) => `  ${l}`).join("\n")}`
      : null,
    input.env.length
      ? `env:\n${input.env.map((e) => `  - ${e}`).join("\n")}`
      : "env: []",
    "",
  ]
    .filter(Boolean)
    .join("\n")

  if (await putFile(token, `${path}/workspace.yaml`, yaml, `Add ${input.slug} workspace`)) {
    created.push(`${path}/workspace.yaml`)
  }

  const skill = `---
name: ${input.slug}-guide
description: "How work is done in the ${input.name} workspace. Use for any task in this workspace before reaching for a general approach."
---

# ${input.name}

Replace this with how the work is actually done here: the steps, the scripts to
prefer, the things that have gone wrong before.

## Scripts
Put runnable scripts in \`scripts/\` and reference them here by name. Prefer an
existing script over writing new code — it has already been tested against real
data, and the agent has not.
`
  const skillPath = `${path}/.claude/skills/${input.slug}-guide/SKILL.md`
  if (await putFile(token, skillPath, skill, `Add starter skill for ${input.slug}`)) {
    created.push(skillPath)
  }

  return { path, created }
}

export interface RepoFile {
  /** Repo-relative path. */
  path: string
  /** Path relative to the workspace folder, for display. */
  name: string
  size: number
}

/**
 * List the files a run would actually see: the workspace folder plus the
 * repo-root .claude (the shared skills), which is exactly the sparse-clone set.
 * Browsing therefore shows what the agent gets — not a different view of it.
 *
 * One recursive tree call rather than walking Contents per directory, so this
 * stays a single request regardless of how deep a workspace nests.
 */
export async function listWorkspaceFiles(
  token: string,
  workspacePath: string,
  branch = "main"
): Promise<{ workspace: RepoFile[]; shared: RepoFile[] }> {
  const [owner, repo] = WORKSPACES_REPO.split("/")
  const res = await ghFetch(
    `${GH}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: headers(token) }
  )
  if (!res.ok) {
    throw new Error(`Could not list files: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as {
    truncated?: boolean
    tree: { path: string; type: string; size?: number }[]
  }
  if (data.truncated) {
    // Surfaced rather than silently showing a partial tree.
    console.warn("[workspace-repo] git tree truncated; file list is incomplete")
  }

  const blobs = data.tree.filter((n) => n.type === "blob")
  const prefix = `${workspacePath}/`
  return {
    workspace: blobs
      .filter((n) => n.path.startsWith(prefix))
      .map((n) => ({ path: n.path, name: n.path.slice(prefix.length), size: n.size ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    shared: blobs
      .filter((n) => n.path.startsWith(".claude/"))
      .map((n) => ({ path: n.path, name: n.path, size: n.size ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Max bytes we will return to the browser for a single file. */
export const MAX_VIEWABLE_BYTES = 256 * 1024

/**
 * Read one file's contents. `path` must be inside the workspace folder or the
 * shared .claude — callers pass a user-supplied value, so the caller checks
 * containment and this refuses anything with traversal as a second line.
 */
export async function readWorkspaceFile(
  token: string,
  path: string
): Promise<{ content: string; truncated: boolean; sha: string }> {
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`unsafe path: ${path}`)
  }
  const [owner, repo] = WORKSPACES_REPO.split("/")
  const res = await ghFetch(
    `${GH}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: headers(token) }
  )
  if (!res.ok) throw new Error(`Could not read ${path}: ${res.status}`)
  const data = (await res.json()) as {
    content?: string
    encoding?: string
    size?: number
    sha?: string
  }
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error(`${path} is not a readable file`)
  }
  const buf = Buffer.from(data.content, "base64")
  const truncated = buf.byteLength > MAX_VIEWABLE_BYTES
  return {
    content: buf.subarray(0, MAX_VIEWABLE_BYTES).toString("utf8"),
    truncated,
    sha: data.sha ?? "",
  }
}

/**
 * Write a file back to the workspaces repo.
 *
 * Saving commits — the repo stays the single source of truth, so an edit here
 * and what the next run clones can never diverge.
 *
 * `sha` is the blob the editor started from. GitHub rejects the write if the
 * file has moved on since, which turns a concurrent edit into a visible
 * conflict rather than one person silently overwriting the other.
 */
export async function writeWorkspaceFile(
  token: string,
  path: string,
  content: string,
  sha: string,
  message: string
): Promise<{ sha: string }> {
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`unsafe path: ${path}`)
  }
  const [owner, repo] = WORKSPACES_REPO.split("/")
  const res = await ghFetch(
    `${GH}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    }
  )
  if (res.status === 409 || res.status === 422) {
    throw new Error(
      "This file changed since you opened it. Reopen it to get the latest version."
    )
  }
  if (!res.ok) throw new Error(`Could not save ${path}: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { content?: { sha?: string } }
  return { sha: data.content?.sha ?? "" }
}
