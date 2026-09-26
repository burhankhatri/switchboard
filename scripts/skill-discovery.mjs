/**
 * Skill discovery, proved in a real sandbox for OpenCode.
 *
 *   Daytona sandbox from the snapshot the app serves
 *     -> sparse-clone exactly what a run gets: the workspace folder and the
 *        repo-root .claude
 *     -> from inside the workspace folder, ask OpenCode which skills it can
 *        load (`opencode debug skill` — no model call, so no credentials)
 *     -> assert every SKILL.md in the workspace and at the repo root is listed
 *     -> tear the sandbox down
 *
 * slice-zero proves this for Claude Code by asking the model. Workspaces can
 * run OpenCode instead (GTM-Lead-Engine does), which finds `.claude/skills`
 * through its Claude-compatible discovery, walking up from cwd to the repo
 * root. Nothing else checks that, and a version bump could quietly break it.
 *
 * Run:  WORKSPACE_PATH=workspaces/gtm-lead-engine \
 *         npx dotenv -e packages/web/.env.local -- node scripts/skill-discovery.mjs
 */
import { execFileSync } from "node:child_process"
import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@switchboard/sandbox-git"

const REPO = process.env.WORKSPACE_REPO ?? "burhankhatri/agent-workspaces"
const WORKSPACE_PATH = process.env.WORKSPACE_PATH ?? "workspaces/gtm-lead-engine"
/** Same preference order as getActiveSnapshotName in packages/sandbox-image. */
const SNAPSHOTS = ["switchboard", "switchboard-temp"]
const REPO_ROOT = "/home/daytona/project"
/** What createSandboxForChat checks out for a workspace run (workspaceSparsePaths). */
const SPARSE = [WORKSPACE_PATH, ".claude"]
const WORKSPACE_DIR = `${REPO_ROOT}/${WORKSPACE_PATH}`

const log = (...a) => console.log(...a)
const githubToken = () => execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim()

async function activeSnapshot(daytona) {
  for (const name of SNAPSHOTS) {
    const snapshot = await daytona.snapshot.get(name).catch(() => null)
    if (snapshot?.state === "active") return name
  }
  throw new Error(`no active snapshot among ${SNAPSHOTS.join(", ")}`)
}

async function run(sandbox, command) {
  const res = await sandbox.process.executeCommand(`bash -lc ${JSON.stringify(command)}`)
  return (res.result ?? "").trim()
}

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  const snapshot = await activeSnapshot(daytona)

  log(`\n[1/4] creating sandbox from snapshot "${snapshot}"...`)
  const sandbox = await daytona.create({
    snapshot,
    autoStopInterval: 15,
    autoDeleteInterval: 60,
    labels: { purpose: "skill-discovery" },
  })

  try {
    log(`[2/4] sparse-cloning ${REPO} (${SPARSE.join(", ")})`)
    await createSandboxGit(sandbox).cloneSparse(
      `https://github.com/${REPO}.git`,
      REPO_ROOT,
      SPARSE,
      "main",
      githubToken()
    )
    const onDisk = (await run(sandbox, `find ${REPO_ROOT} -path '*/.claude/skills/*/SKILL.md' | sort`))
      .split("\n")
      .filter(Boolean)
    log(`      ${onDisk.length} SKILL.md files checked out`)

    log(`[3/4] asking OpenCode, from ${WORKSPACE_DIR}`)
    const version = await run(sandbox, "opencode --version")
    // Written to a file, never read from a pipe: `debug skill` prints every
    // skill's full body (200KB+ for a real workspace) and exits before a pipe
    // drains, so piped output stops at exactly 64KB — three or four skills —
    // which reads as the rest going missing. A file receives all of it.
    const listed = await run(
      sandbox,
      `cd ${WORKSPACE_DIR} && opencode debug skill > /tmp/opencode-skills.json 2>/dev/null; ` +
        `grep -o '"location": "[^"]*"' /tmp/opencode-skills.json`
    )
    const locations = new Set([...listed.matchAll(/"location":\s*"([^"]+)"/g)].map((m) => m[1]))
    log(`      opencode ${version} lists ${locations.size} skills`)

    log("[4/4] assertions")
    const siblings = (await run(sandbox, `ls ${REPO_ROOT}/workspaces | sort`)).split("\n").filter(Boolean)
    const slug = WORKSPACE_PATH.split("/").pop()
    const checks = [
      ["at least one workspace skill and one repo-root skill checked out",
        onDisk.some((p) => p.startsWith(`${WORKSPACE_DIR}/`)) && onDisk.some((p) => p.startsWith(`${REPO_ROOT}/.claude/`))],
      ...onDisk.map((p) => [`OpenCode lists ${p.slice(REPO_ROOT.length + 1)}`, locations.has(p)]),
      [`isolation: only ${slug} checked out (got: ${siblings.join(", ") || "none"})`,
        siblings.length === 1 && siblings[0] === slug],
    ]
    let ok = true
    for (const [name, pass] of checks) {
      log(`      ${pass ? "PASS" : "FAIL"}  ${name}`)
      if (!pass) ok = false
    }
    if (!ok) {
      // Enough to tell a discovery bug from an environment one without
      // re-running by hand: what OpenCode saw, and what it was configured with.
      log("\n--- what OpenCode listed ---")
      log([...locations].map((l) => `      ${l}`).join("\n"))
      log("\n--- environment ---")
      log(await run(sandbox, [
        "env | grep -i -E 'opencode|claude|xdg' | sed 's/=.*/=<set>/'",
        "ls -la ~/.config/opencode ~/.claude ~/.local/share/opencode 2>&1 | head -40",
        `cd ${WORKSPACE_DIR} && opencode debug skill --print-logs --log-level DEBUG 2>&1 >/dev/null | grep -i -E 'skill|warn|error' | head -40`,
      ].join("; echo; ")))
    }
    log(ok ? "\nSKILL DISCOVERY: PASS" : "\nSKILL DISCOVERY: FAIL")
    process.exitCode = ok ? 0 : 1
  } finally {
    log(`\ndestroying sandbox ${sandbox.id}...`)
    await sandbox.delete().catch((e) => log("  (delete failed)", e.message))
  }
}

main().catch((e) => {
  console.error("\nskill-discovery failed:", e)
  process.exit(1)
})
