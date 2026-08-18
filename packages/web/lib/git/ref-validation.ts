/**
 * Allowlist validators for values that get interpolated into sandbox shell
 * commands and GitHub API URLs (see app/api/sandbox/git/route.ts and the git
 * helpers it calls). The route validates request-body values against these at a
 * single choke point so no downstream command/URL can be injected. The
 * allowlists intentionally contain no shell or URL metacharacters; the app's
 * own values (paths like `/home/daytona/project`, refs like `feat/x`) all pass.
 */

/** Absolute POSIX path, safe charset, no traversal. */
export function isSafeRepoPath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 512 &&
    v.startsWith("/") &&
    /^[A-Za-z0-9._/-]+$/.test(v) &&
    !v.includes("..")
  )
}

/**
 * Repo-RELATIVE directory, safe charset, no traversal, no leading/trailing '/'.
 * Used for Workspace.path, which is interpolated into the agent's sandbox cwd
 * (`<PROJECT_DIR>/<path>`). Distinct from isSafeRepoPath, which requires an
 * absolute path — a leading '/' here would escape the clone entirely.
 */
export function isSafeWorkspacePath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 400 &&
    !v.startsWith("/") &&
    !v.endsWith("/") &&
    /^[A-Za-z0-9._/-]+$/.test(v) &&
    !v.includes("..")
  )
}

/** Conservative git ref name: no leading '-'/'/', no trailing '/', no '..'. */
export function isSafeBranchName(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 255 &&
    /^[A-Za-z0-9._/-]+$/.test(v) &&
    !v.startsWith("-") &&
    !v.startsWith("/") &&
    !v.endsWith("/") &&
    !v.includes("..")
  )
}

/** GitHub owner or repo name: alphanumerics plus . _ -, no leading '-'. */
export function isSafeRepoSegment(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 100 &&
    /^[A-Za-z0-9._-]+$/.test(v) &&
    !v.startsWith("-") &&
    !v.includes("..")
  )
}
