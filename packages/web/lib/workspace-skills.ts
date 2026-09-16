/**
 * Where a workspace's skills live, and how one is named.
 *
 * Claude Code discovers skills in `.claude/skills/` in the working directory
 * and every parent up to the repo root. That directory layout is the whole
 * discovery mechanism, so the path is not a preference — a SKILL.md one level
 * off is a skill the agent will never read. Keeping the rule here, and calling
 * it from the server, means adding a skill cannot put one in the wrong place
 * even when whoever added it has never heard of the convention.
 */

/** Skill directory, relative to the workspace folder. */
export const SKILLS_DIR = ".claude/skills"

/** Longest slug we will mint. Directory names, so keep them short enough to read. */
const MAX_SLUG_LENGTH = 64

export interface SkillSummary {
  /** Directory name under `.claude/skills/`. Stable id for the skill. */
  slug: string
  /** `name` from the frontmatter, falling back to the slug. */
  name: string
  /** `description` from the frontmatter — what the model matches a task against. */
  description: string
  /** Repo-relative path of the SKILL.md. */
  path: string
  /** Other files in the skill folder (references, scripts it ships with). */
  extraFiles: number
}

/**
 * A directory name derived from what a person typed.
 *
 * Returns "" when nothing usable survives, which the caller reports rather than
 * committing a folder called `-` or `.`.
 */
export function skillSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "")
}

/** Repo-relative path of a skill's SKILL.md. */
export function skillPath(workspacePath: string, slug: string): string {
  return `${workspacePath}/${SKILLS_DIR}/${slug}/SKILL.md`
}

/** Repo-relative path of the folder a skill owns. */
export function skillDir(workspacePath: string, slug: string): string {
  return `${workspacePath}/${SKILLS_DIR}/${slug}`
}

/**
 * Parse the leading YAML frontmatter of a SKILL.md.
 *
 * Flat `key: value` pairs only, which is all the skill format defines. A full
 * YAML parser would accept documents the agent's own loader does not, so
 * matching its strictness is the point rather than a shortcut.
 *
 * Returns null when there is no frontmatter block at all.
 */
export function parseSkillFrontmatter(
  content: string
): { name: string; description: string } | null {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") return null

  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      close = i
      break
    }
  }
  if (close === -1) return null

  let name = ""
  let description = ""
  for (const line of lines.slice(1, close)) {
    const match = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (!match) continue
    const value = match[2].trim().replace(/^["']|["']$/g, "")
    if (match[1] === "name") name = value
    if (match[1] === "description") description = value
  }

  return { name, description }
}

/**
 * The skill folders present in a workspace, from the file list alone.
 *
 * `names` are workspace-relative, as `listWorkspaceFiles` returns them. A
 * folder only counts as a skill once it has a SKILL.md — a `references/` file
 * committed before the skill itself should not show up as a nameless skill.
 */
export function listSkillSlugs(
  names: string[]
): { slug: string; extraFiles: number }[] {
  const seen = new Map<string, number>()
  const withSkillMd = new Set<string>()

  for (const name of names) {
    if (!name.startsWith(`${SKILLS_DIR}/`)) continue
    const rest = name.slice(SKILLS_DIR.length + 1)
    const slash = rest.indexOf("/")
    if (slash <= 0) continue // a loose file directly in .claude/skills/
    const slug = rest.slice(0, slash)
    const within = rest.slice(slash + 1)
    if (within === "SKILL.md") {
      withSkillMd.add(slug)
    } else if (within !== ".gitkeep") {
      seen.set(slug, (seen.get(slug) ?? 0) + 1)
    }
  }

  return [...withSkillMd]
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => ({ slug, extraFiles: seen.get(slug) ?? 0 }))
}

/**
 * The SKILL.md a new skill starts as.
 *
 * The description is quoted because it is free text a person typed and commonly
 * contains a colon, which unquoted would make the frontmatter parse as
 * something else entirely. The body is prompts rather than prose: an empty
 * skill teaches the agent nothing, and the headings are the ones that have
 * turned out to matter.
 */
export function scaffoldSkillMarkdown(input: {
  slug: string
  title: string
  description: string
}): string {
  return `---
name: ${input.slug}
description: ${JSON.stringify(input.description)}
---

# ${input.title}

## When to use this
${input.description}

## How the work is done
Replace this with the actual steps. Prefer a script in \`scripts/\` over asking
the agent to write new code — a committed script has been run against real data
and improvised code has not.

## What has gone wrong before
The reason this file exists. Anything surprising about the API, the data, or the
business that an agent would otherwise have to rediscover the hard way.
`
}
