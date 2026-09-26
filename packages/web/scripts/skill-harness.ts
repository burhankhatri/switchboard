/**
 * Skill harness: prove a workspace's skills reach its agent, through the code a
 * real chat turn runs.
 *
 *   createSandboxForChat         the production sandbox: the active snapshot (or
 *                                --snapshot), the sparse checkout
 *                                workspaceSparsePaths chooses
 *   createBackgroundAgentSession the production launch: system prompt, OpenCode
 *                                permissions, cwd inside the workspace folder,
 *                                model and env from getEnvForModel
 *   one real turn                the agent loads a workspace skill and a shared
 *                                one through its skill tool — each carrying a
 *                                canary written into the sandbox only — and
 *                                names every skill it can see
 *   opencode debug skill         after the turn, OpenCode's own listing, read
 *                                whole from a file
 *
 * Checks (lib/skill-harness.ts): every SKILL.md the agent's discovery reaches is
 * listed and seen by the model; each probe came through the skill tool, not a
 * read around it; the Skills panel shows every workspace skill the agent loads;
 * only this workspace is on disk.
 *
 * Not reproduced: a workspace's connections and MCP servers come from the
 * database, and neither takes part in skill discovery.
 *
 *   npm run test:skills -- --workspace workspaces/gtm-lead-engine
 *     [--agent opencode,claude-code] [--snapshot switchboard-temp] [--model <id>]
 *
 * Env (packages/web/.env.local locally, secrets in CI): DAYTONA_API_KEY,
 * WORKSPACES_REPO, and WORKSPACES_REPO_TOKEN with read access to it (falls back
 * to GH_TOKEN, then `gh auth token`). OPENCODE_API_KEY for OpenCode;
 * CLAUDE_CODE_CREDENTIALS for Claude Code (falls back to the macOS keychain).
 */
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { loadEnvFiles } from "../lib/load-env-files"

type Check = import("../lib/skill-harness").Check

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function githubToken(): string {
  const fromEnv = process.env.WORKSPACES_REPO_TOKEN ?? process.env.GH_TOKEN
  if (fromEnv) return fromEnv
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim()
}

/** Only the OAuth object, never the whole keychain entry (it holds unrelated tokens). */
function claudeCredentials(): string | undefined {
  if (process.env.CLAUDE_CODE_CREDENTIALS) return process.env.CLAUDE_CODE_CREDENTIALS
  if (process.platform !== "darwin") return undefined
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-a", process.env.USER ?? "", "-w"],
      { encoding: "utf8" }
    ).trim()
    const { claudeAiOauth } = JSON.parse(raw)
    return claudeAiOauth ? JSON.stringify({ claudeAiOauth }) : undefined
  } catch {
    return undefined
  }
}

const log = (line = "") => console.log(line)

async function runAgent(agentName: string, workspacePath: string): Promise<Check[]> {
  // sandbox.ts builds a Prisma client at import. The harness never queries it,
  // so a placeholder keeps it constructible where no database exists (CI).
  process.env.DATABASE_URL ??= "postgresql://harness:unused@localhost:5432/unused"

  const { Daytona } = await import("@daytonaio/sdk")
  const { getSession } = await import("@switchboard/sdk")
  const { defaultAgentModel, getEnvForModel, resolveCliModel } = await import("@switchboard/common")
  const { renderOpenCodePermissionEnv } = await import("@switchboard/agent-configuration/permissions")
  const { createSandboxForChat, discoverSkillsForRepo } = await import("../lib/sandbox")
  const { createBackgroundAgentSession, snapshotBackgroundAgent } = await import("../lib/agent-session")
  const { workspaceSessionOptions, workspaceSparsePaths } = await import("../lib/workspace")
  const { listSkillSlugs, parseSkillFrontmatter, SKILLS_DIR } = await import("../lib/workspace-skills")
  const { PATHS } = await import("../lib/constants")
  const { DEFAULT_GIT_POLICY } = await import("../lib/git-policy")
  const h = await import("../lib/skill-harness")

  const repo = required("WORKSPACES_REPO")
  const daytona = new Daytona({ apiKey: required("DAYTONA_API_KEY") })
  const sparsePaths = workspaceSparsePaths({ repo, path: workspacePath }, repo)
  const snapshot = arg("snapshot")

  log(`\n[${agentName}] creating the production sandbox${snapshot ? ` from "${snapshot}"` : ""}...`)
  const { sandbox, previewUrlPattern } = await createSandboxForChat({
    daytona,
    repo,
    baseBranch: "main",
    // Local only: createSandboxForChat creates it and never pushes.
    newBranch: `skill-harness-${randomUUID().slice(0, 8)}`,
    githubToken: githubToken(),
    sparsePaths,
    userId: "harness",
    snapshot,
  })

  const sh = async (command: string, env?: Record<string, string>) =>
    (await sandbox.process.executeCommand(command, undefined, env, 300)).result.trim()
  const readFile = async (file: string) => (await sandbox.fs.downloadFile(file)).toString("utf8")

  try {
    const repoPath = `${PATHS.SANDBOX_HOME}/project`
    const workspaceDir = `${repoPath}/${workspacePath}`

    const config = h.parseWorkspaceYaml(await readFile(`${workspaceDir}/workspace.yaml`).catch(() => ""))
    const agent = agentName as keyof typeof defaultAgentModel
    const model = arg("model") ?? (config.agent === agentName ? config.model : undefined) ?? defaultAgentModel[agent]

    const allSkillFiles = (await sh(`find ${repoPath} -name SKILL.md -not -path '*/.git/*'`)).split("\n").filter(Boolean)
    const expected = h.expectedSkillFiles(allSkillFiles, repoPath, workspaceDir).sort()
    if (expected.length === 0) throw new Error(`no skills under ${workspacePath} or above it — nothing to prove`)

    const names = new Map<string, string>()
    for (const file of expected) {
      const parsed = parseSkillFrontmatter(await readFile(file))
      names.set(file, parsed?.name?.trim() || path.basename(path.dirname(file)))
    }

    // The panel's view, computed by the app's own listSkillSlugs.
    const inWorkspace = (await sh(`cd ${workspaceDir} && find ${SKILLS_DIR} -type f`)).split("\n").filter(Boolean)
    const panelFiles = listSkillSlugs(inWorkspace).map((s) => `${workspaceDir}/${SKILLS_DIR}/${s.slug}/SKILL.md`)

    // One probe in the workspace, one above it, so both ends of the walk are used.
    const workspaceSkill = expected.find((f) => f.startsWith(`${workspaceDir}/`))
    const sharedSkill = expected.find((f) => !f.startsWith(`${workspaceDir}/`))
    const probes: import("../lib/skill-harness").Probe[] = []
    for (const file of [workspaceSkill, sharedSkill].filter((f): f is string => !!f)) {
      const canary = `harness-${randomUUID()}`
      await sh(`printf '\\n\\nHarness canary: %s\\n' '${canary}' >> '${file}'`)
      probes.push({ skill: names.get(file)!, dir: path.basename(path.dirname(file)), canary })
    }

    const credentials = {
      OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
      CLAUDE_CODE_CREDENTIALS: agentName === "claude-code" ? claudeCredentials() : undefined,
    }
    const env = getEnvForModel(model, agent, credentials as never)
    if (Object.keys(env).length === 0) {
      throw new Error(
        agentName === "claude-code"
          ? "no Claude Code credentials: set CLAUDE_CODE_CREDENTIALS or sign in to Claude Code on this Mac"
          : `no credentials for ${model}: set OPENCODE_API_KEY`
      )
    }

    const sessionOptions = {
      repoPath,
      ...workspaceSessionOptions({ path: workspacePath, systemPrompt: config.systemPrompt ?? null }),
      previewUrlPattern,
      agent: agent as never,
      model: resolveCliModel(model),
      env,
    }
    const catalog = await discoverSkillsForRepo(sandbox, repoPath)
    const session = await createBackgroundAgentSession(sandbox, {
      ...sessionOptions,
      skills: catalog.length > 0 ? catalog : undefined,
    })

    log(`[${agentName}] one turn on ${model}, probing ${probes.map((p) => p.skill).join(" + ")}...`)
    await session.start(h.usagePrompt(probes))
    const deadline = Date.now() + 8 * 60_000
    let result = await snapshotBackgroundAgent(sandbox, session.backgroundSessionId, sessionOptions)
    while (result.status === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      result = await snapshotBackgroundAgent(sandbox, session.backgroundSessionId, sessionOptions)
    }
    const raw = await (await getSession(session.backgroundSessionId, { sandbox })).getSnapshot()
    const tools = (raw.events as { type: string; name?: string; input?: unknown }[])
      .filter((e) => e.type === "tool_start" && e.name)
      .map((e) => ({ name: e.name!, input: e.input }))
    log(`[${agentName}] reply:\n${result.content.split("\n").map((l) => `    ${l}`).join("\n")}`)

    const checks: Check[] = h.usageChecks({
      probes,
      reply: result.content,
      tools,
      status: result.status === "running" ? "timed out" : result.status,
      error: result.error,
      expectedNames: [...names.values()],
    })

    if (agentName === "opencode") {
      // After the turn, so the config the session wrote is in force. Written to
      // a file and downloaded whole: piped, the listing stops at 64KB.
      const permission = renderOpenCodePermissionEnv(DEFAULT_GIT_POLICY)
      await sh(`cd ${workspaceDir} && opencode debug skill > /tmp/harness-skills.json 2>/dev/null`, {
        ...env,
        OPENCODE_PERMISSION: permission,
      })
      const listed = h.parseOpencodeSkillList(await readFile("/tmp/harness-skills.json"))
      checks.push(...h.discoveryChecks({ expected, listed, panelFiles, workspaceDir, repoRoot: repoPath }))
    }

    const checkedOut = (await sh(`ls ${repoPath}/workspaces`)).split("\n").filter(Boolean)
    const slug = path.basename(workspacePath)
    checks.push({
      name: `only ${slug} is checked out (found: ${checkedOut.join(", ")})`,
      pass: checkedOut.length === 1 && checkedOut[0] === slug,
    })
    return checks
  } finally {
    await sandbox.delete().catch((e: Error) => log(`  (could not delete sandbox ${sandbox.id}: ${e.message})`))
  }
}

async function main() {
  loadEnvFiles(path.resolve(__dirname, ".."))
  const workspacePath = arg("workspace") ?? "workspaces/gtm-lead-engine"
  const agents = (arg("agent") ?? "opencode").split(",").map((a) => a.trim())

  let failed = 0
  for (const agent of agents) {
    let checks: Check[]
    try {
      checks = await runAgent(agent, workspacePath)
    } catch (err) {
      checks = [{ name: "the harness ran", pass: false, detail: err instanceof Error ? err.message : String(err) }]
    }
    log(`\n[${agent}] ${workspacePath}`)
    for (const c of checks) {
      log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
      if (!c.pass) failed++
    }
  }
  log(failed === 0 ? "\nSKILL HARNESS: PASS" : `\nSKILL HARNESS: FAIL (${failed} failed)`)
  process.exitCode = failed === 0 ? 0 : 1
}

void main()
