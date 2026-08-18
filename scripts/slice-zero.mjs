/**
 * Slice zero: prove the whole mechanism with no web app, no auth, no UI.
 *
 *   Daytona sandbox from the prebuilt snapshot
 *     -> clone the agent-workspaces repo
 *     -> write ~/.claude/.credentials.json from the local keychain
 *     -> run Claude Code headless with cwd INSIDE the workspace folder
 *     -> assert both the workspace's skills and the repo-root shared skills loaded
 *     -> tear the sandbox down
 *
 * Run:  npx dotenv -e packages/web/.env.local -- node scripts/slice-zero.mjs
 */
import { execFileSync } from "node:child_process"
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@switchboard/sdk"
import { createSandboxGit } from "@switchboard/sandbox-git"

const REPO = process.env.WORKSPACE_REPO ?? "burhankhatri/agent-workspaces"
const WORKSPACE_PATH = process.env.WORKSPACE_PATH ?? "workspaces/marketing-automation"
const SNAPSHOT = "background-agents"
const REPO_ROOT = "/home/daytona/project"
/**
 * Paths fetched on every run. The workspace's own folder, plus the repo-root
 * `.claude` so the shared skills still resolve via parent-directory discovery.
 * Everything else in the monorepo is never downloaded.
 */
const SPARSE = [WORKSPACE_PATH, ".claude"]
const WORKSPACE_DIR = `${REPO_ROOT}/${WORKSPACE_PATH}`
const PROMPT =
  process.env.PROMPT ??
  "List the skills you can see and where each came from. Then run the segment summary script on its sample CSV, grouping by state, and show the output. Do not write to any system of record."

const log = (...a) => console.log(...a)
const sh = (cmd) => execFileSync("bash", ["-lc", cmd], { encoding: "utf8" }).trim()

/** Only the claudeAiOauth object — never the whole keychain blob (it holds unrelated MCP tokens). */
function claudeCredentials() {
  const raw = sh(
    `security find-generic-password -s "Claude Code-credentials" -a "$USER" -w`
  )
  const { claudeAiOauth } = JSON.parse(raw)
  if (!claudeAiOauth?.accessToken) throw new Error("no claudeAiOauth in keychain")
  return JSON.stringify({ claudeAiOauth })
}

function githubToken() {
  return sh("gh auth token")
}

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

  log(`\n[1/5] creating sandbox from snapshot "${SNAPSHOT}"...`)
  const t0 = Date.now()
  const sandbox = await daytona.create({
    snapshot: SNAPSHOT,
    autoStopInterval: 15,
    autoDeleteInterval: 60,
    labels: { purpose: "slice-zero" },
  })
  log(`      sandbox ${sandbox.id} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  try {
    log(`[2/5] sparse-cloning ${REPO} -> ${REPO_ROOT}`)
    log(`      assets fetched: ${SPARSE.join(", ")}`)
    const git = createSandboxGit(sandbox)
    await git.cloneSparse(
      `https://github.com/${REPO}.git`,
      REPO_ROOT,
      SPARSE,
      "main",
      githubToken()
    )

    const tree = await sandbox.process.executeCommand(
      `find ${REPO_ROOT} -name SKILL.md | sort; ` +
        `echo "--- checked out top level ---"; ls -A ${REPO_ROOT}; ` +
        `echo "--- worktree size ---"; du -sh ${REPO_ROOT} | cut -f1`
    )
    log((tree.result ?? "").trim().split("\n").map((l) => `        ${l}`).join("\n"))

    log(`[3/5] starting Claude Code with cwd=${WORKSPACE_DIR}`)
    const session = await createSession("claude", {
      sandbox,
      cwd: WORKSPACE_DIR,
      env: { CLAUDE_CODE_CREDENTIALS: claudeCredentials() },
    })
    await session.start(PROMPT)

    log(`[4/5] streaming...\n${"─".repeat(72)}`)
    const seen = new Set()
    let init = null
    let text = ""
    for (;;) {
      const r = await session.poll()
      for (const ev of r.events) {
        const key = JSON.stringify(ev).slice(0, 200)
        if (seen.has(key)) continue
        seen.add(key)
        if (ev.type === "system" || ev.subtype === "init") init ??= ev
        if (ev.type === "token" && ev.text) {
          text += ev.text
          process.stdout.write(ev.text)
        } else if (ev.type === "tool_start") {
          log(`\n  [tool] ${ev.name ?? ""} ${JSON.stringify(ev.input ?? {}).slice(0, 160)}`)
        }
      }
      if (!r.running) break
      await new Promise((res) => setTimeout(res, 1500))
    }
    log(`\n${"─".repeat(72)}`)

    log("[5/5] assertions")
    const slug = WORKSPACE_PATH.split("/").pop()
    // Derived from the workspace under test, not hardcoded, so this script is
    // usable against any workspace.
    const onDisk = await sandbox.process.executeCommand(
      `ls ${REPO_ROOT}/workspaces 2>/dev/null | sort | tr '\\n' ' '`
    )
    const siblings = (onDisk.result ?? "").trim().split(/\s+/).filter(Boolean)
    const checks = [
      [
        `workspace's own skill visible to the model (${slug})`,
        new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
      ],
      ["shared root skill (crm-write-safety) visible to the model", /crm-write-safety/i.test(text)],
      [
        `isolation: only ${slug} checked out (got: ${siblings.join(", ") || "none"})`,
        siblings.length === 1 && siblings[0] === slug,
      ],
    ]
    let ok = true
    for (const [name, pass] of checks) {
      log(`      ${pass ? "PASS" : "FAIL"}  ${name}`)
      if (!pass) ok = false
    }
    if (init) log(`\n      system/init: ${JSON.stringify(init).slice(0, 600)}`)
    log(ok ? "\nSLICE ZERO: PASS" : "\nSLICE ZERO: FAIL")
    process.exitCode = ok ? 0 : 1
  } finally {
    log(`\ndestroying sandbox ${sandbox.id}...`)
    await sandbox.delete().catch((e) => log("  (delete failed)", e.message))
  }
}

main().catch((e) => {
  console.error("\nslice-zero failed:", e)
  process.exit(1)
})
