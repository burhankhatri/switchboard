import { spawn } from "node:child_process"
import { Daytona } from "@daytonaio/sdk"
import { rebuildSnapshot } from "../src/index"

/**
 * The workspace and agents a new image is proved against. Every agent a
 * workspace can run (ALL_AGENTS in @switchboard/common), and a workspace with
 * skills both in its own folder and at the repo root.
 */
const WORKSPACE = process.env.SKILL_HARNESS_WORKSPACE ?? "workspaces/gtm-lead-engine"
const AGENTS = process.env.SKILL_HARNESS_AGENTS ?? "opencode,claude-code"

/** Run the skill harness against a snapshot; reject unless every check passes. */
function verifySkills(snapshot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "test:skills", "-w", "@switchboard/web", "--", "--snapshot", snapshot, "--workspace", WORKSPACE, "--agent", AGENTS],
      { stdio: "inherit" }
    )
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`the skill harness failed against "${snapshot}"`))
    )
  })
}

// Zero-downtime (re)build of the canonical agent-sandbox snapshot.
// Builds via a transient temp snapshot so new sandboxes always have a ready
// snapshot to launch from, and proves skills still reach every agent on it
// before it replaces the live one. Safe to run while the app is live. See
// rebuildSnapshot() for the step-by-step flow.
async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error("DAYTONA_API_KEY is not set")
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })
  const snapshot = await rebuildSnapshot(daytona, {
    onLog: (line) => console.log(line),
    verify: verifySkills,
  })
  console.log(`\nActive snapshot: ${snapshot.name}`)
}

main().catch((err) => {
  console.error("Snapshot build failed:", err)
  process.exit(1)
})
