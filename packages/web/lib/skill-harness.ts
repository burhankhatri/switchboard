/**
 * The decisions behind scripts/skill-harness.ts, kept pure so they can be
 * tested without a sandbox. The script does the I/O; everything here decides
 * what counts as a skill the agent must see, and whether a run proved it.
 */

export interface WorkspaceConfig {
  agent?: string
  model?: string
  systemPrompt?: string
}

/**
 * Read a workspace.yaml in the shape scaffoldWorkspace writes: top-level
 * `key: value` scalars and `systemPrompt: |` as a block indented two spaces.
 */
export function parseWorkspaceYaml(text: string): WorkspaceConfig {
  const config: WorkspaceConfig = {}
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(agent|model|systemPrompt):\s*(.*)$/)
    if (!match) continue
    const [, key, raw] = match
    if (key === "systemPrompt" && raw.trim() === "|") {
      const block: string[] = []
      while (i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].trim() === "")) {
        block.push(lines[++i].slice(2))
      }
      config.systemPrompt = block.join("\n").trimEnd()
    } else {
      config[key as keyof WorkspaceConfig] = raw.trim().replace(/^"(.*)"$/, "$1")
    }
  }
  return config
}

/**
 * The SKILL.md files an agent started in `workspaceDir` must be able to load:
 * any under a `.claude/skills` folder in that directory or an ancestor, up to
 * and including `repoRoot` — the walk OpenCode and Claude Code both do.
 * Nested skill folders count; OpenCode matches `skills/**\/SKILL.md`.
 */
export function expectedSkillFiles(skillFiles: string[], repoRoot: string, workspaceDir: string): string[] {
  const roots: string[] = []
  for (let dir = workspaceDir; ; dir = dir.slice(0, dir.lastIndexOf("/"))) {
    roots.push(`${dir}/.claude/skills/`)
    if (dir === repoRoot || !dir.includes("/")) break
  }
  return skillFiles.filter((f) => f.endsWith("/SKILL.md") && roots.some((r) => f.startsWith(r)))
}

export interface ListedSkill {
  name: string
  location: string
}

/**
 * `opencode debug skill` output. It prints every skill's full body, and a
 * reader that gets only part of it — a pipe cuts it at 64KB — would otherwise
 * report the rest as missing. Anything that is not whole JSON is refused.
 */
export function parseOpencodeSkillList(json: string): ListedSkill[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`OpenCode's skill listing is incomplete (${json.length} bytes did not parse as JSON)`)
  }
  if (!Array.isArray(parsed)) throw new Error("OpenCode's skill listing is not a list")
  return parsed.map((s: { name: string; location: string }) => ({ name: s.name, location: s.location }))
}

export interface Check {
  name: string
  pass: boolean
  detail?: string
}

export function discoveryChecks({
  expected,
  listed,
  panelFiles,
  workspaceDir,
  repoRoot,
}: {
  /** Absolute SKILL.md paths from expectedSkillFiles. */
  expected: string[]
  /** What the agent reports it can load. */
  listed: ListedSkill[]
  /** Absolute SKILL.md paths the Skills panel would show for this workspace. */
  panelFiles: string[]
  workspaceDir: string
  repoRoot: string
}): Check[] {
  const rel = (p: string) => (p.startsWith(`${repoRoot}/`) ? p.slice(repoRoot.length + 1) : p)
  const locations = new Set(listed.map((s) => s.location))
  const panel = new Set(panelFiles)

  return [
    ...expected.map((f) => ({ name: `the agent lists ${rel(f)}`, pass: locations.has(f) })),
    // The panel is where people decide what the agent knows; a skill the agent
    // loads but the panel hides is one nobody will think to fix or remove.
    ...listed
      .filter((s) => s.location.startsWith(`${workspaceDir}/`))
      .map((s) => ({ name: `the Skills panel shows ${s.name}, which the agent loads`, pass: panel.has(s.location) })),
  ]
}

export interface Probe {
  /** The skill's frontmatter name — what the skill tool is called with. */
  skill: string
  /** Its folder under .claude/skills, used to spot a read around the tool. */
  dir: string
  /** A value written into the skill in the sandbox only; unguessable. */
  canary: string
}

export function usagePrompt(probes: Probe[]): string {
  return [
    `Use your skill tool to load each of these skills: ${probes.map((p) => p.skill).join(", ")}.`,
    'Each one contains a line starting with "Harness canary:".',
    "Do not open the skill files any other way — use only the skill tool.",
    "Reply in exactly this format and nothing else:",
    "CANARIES:",
    "<each canary value, one per line, in the order above>",
    "SKILLS:",
    "<the exact name of every skill available to you, one per line>",
  ].join("\n")
}

export function parseReply(reply: string): { canaries: string[]; skills: string[] } {
  const section = (from: string, to?: string) => {
    const start = reply.indexOf(from)
    if (start === -1) return []
    const end = to ? reply.indexOf(to, start) : -1
    return reply
      .slice(start + from.length, end === -1 ? undefined : end)
      .split("\n")
      .map((l) => l.replace(/^[\s*`-]+|[\s*`]+$/g, ""))
      .filter(Boolean)
  }
  return { canaries: section("CANARIES:", "SKILLS:"), skills: section("SKILLS:") }
}

export interface ToolEvent {
  name: string
  input?: unknown
}

const isSkillTool = (t: ToolEvent) => t.name.toLowerCase() === "skill"
const mentions = (t: ToolEvent, text: string) => JSON.stringify(t.input ?? "").includes(text)

export function usageChecks({
  probes,
  reply,
  tools,
  status,
  error,
  expectedNames,
}: {
  probes: Probe[]
  reply: string
  tools: ToolEvent[]
  status: string
  error?: string
  /** Frontmatter names of every expected skill. */
  expectedNames: string[]
}): Check[] {
  const { skills } = parseReply(reply)
  const seen = new Set(skills)
  return [
    { name: "the turn completed", pass: status === "completed", detail: error },
    ...probes.flatMap((p) => {
      const readAround = tools.some((t) => !isSkillTool(t) && mentions(t, `skills/${p.dir}/`))
      return [
        {
          name: `${p.skill}: loaded through the skill tool`,
          // A read of the file proves file access, not the skill mechanism, so
          // it does not count even alongside a skill-tool call.
          pass: tools.some((t) => isSkillTool(t) && mentions(t, p.skill)) && !readAround,
        },
        { name: `${p.skill}: its canary reached the model`, pass: reply.includes(p.canary) },
        { name: `${p.skill}: not read around the skill tool`, pass: !readAround },
      ]
    }),
    ...expectedNames.map((n) => ({ name: `the model sees ${n}`, pass: seen.has(n) })),
  ]
}
