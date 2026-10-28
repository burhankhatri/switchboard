/**
 * Which agent commits may land on the base branch without a person.
 *
 * Each chat starts from a fresh clone of main, but what an agent writes sits on
 * its agent/* branch until someone merges. A campaign spec or a LEARNINGS entry
 * written in one chat was invisible to the next, which reconstructed it from
 * the external system instead. Documentation under these paths is inert — no
 * script, skill or config reads it to decide what to do — so landing it is a
 * visibility gain with a `git revert` as the undo. Everything else keeps the
 * review step.
 */
export const DOC_ONLY_PATTERNS = [
  "campaigns/**",
  "LEARNINGS.md",
  "HOME.md",
  ".claude/skills/**/reference/**",
] as const

export type DocOnlyDecision = { merge: true; files: number } | { merge: false; reason: string }

function patternToRegExp(pattern: string): RegExp {
  // `**` crosses directories, `*` does not; everything else is literal.
  const escaped = pattern
    .split("**")
    .map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*")
  return new RegExp(`^${escaped}$`)
}

const MATCHERS = DOC_ONLY_PATTERNS.map(patternToRegExp)

function isDocPath(relative: string): boolean {
  return MATCHERS.some((re) => re.test(relative))
}

/**
 * Decide from `git diff --name-status <base>...HEAD` lines, with paths from
 * the repo root and the workspace folder they must sit under.
 */
export function docOnlyMergeDecision(nameStatusLines: string[], workspacePath: string): DocOnlyDecision {
  const prefix = workspacePath.replace(/\/+$/, "") + "/"
  const rows = nameStatusLines.map((l) => l.trim()).filter(Boolean)
  if (rows.length === 0) return { merge: false, reason: "nothing to merge" }

  for (const row of rows) {
    const cols = row.split("\t")
    // A rename or copy lists source then destination; the destination is where
    // the content now lives and is what the allowlist judges.
    const path = cols[cols.length - 1]
    if (!path) return { merge: false, reason: `unreadable diff line: ${row}` }
    if (!path.startsWith(prefix)) return { merge: false, reason: `${path} is outside ${workspacePath}` }
    const relative = path.slice(prefix.length)
    if (!isDocPath(relative)) return { merge: false, reason: `${path} is not documentation` }
  }
  return { merge: true, files: rows.length }
}
