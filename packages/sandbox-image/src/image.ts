import { Image } from "@daytonaio/sdk"

/**
 * Snapshot names. `SNAPSHOT_NAME` is the canonical snapshot the app always
 * serves; `SNAPSHOT_NAME_TEMP` is transient scratch space used only *during*
 * a zero-downtime rebuild (see rebuildSnapshot) and is always cleaned up.
 * The app calls getActiveSnapshotName() to discover which one to use at
 * runtime — no env var or config needed.
 */
export const SNAPSHOT_NAME = "switchboard"
export const SNAPSHOT_NAME_TEMP = "switchboard-temp"

/** Both possible snapshot names (for lookups). */
export const ALL_SNAPSHOT_NAMES = [SNAPSHOT_NAME, SNAPSHOT_NAME_TEMP] as const

/**
 * Daytona snapshot state meaning "built and ready to launch sandboxes from".
 * Other states (building, pending, pulling, removing, error, build_failed)
 * mean the snapshot must NOT be served. Matches SnapshotState.ACTIVE from
 * @daytona/api-client — kept as a literal to avoid a direct dependency.
 */
const SNAPSHOT_STATE_ACTIVE = "active"

/**
 * Resolves the snapshot the app should launch new sandboxes from.
 *
 * Returns the first name in preference order (canonical, then temp) whose
 * snapshot exists AND is in the `active` (ready) state. A snapshot that is
 * still building, being removed, or errored is invisible here — this is what
 * makes rebuilds zero-downtime: while the canonical snapshot is mid-rebuild,
 * the (ready) temp snapshot is served instead, and vice versa.
 *
 * Throws if no snapshot is ready — caller should handle first-run bootstrap.
 */
/**
 * Cache of the resolved snapshot name.
 *
 * This is called on EVERY sandbox creation and probes the Daytona control plane
 * one snapshot at a time — network round trips to answer a question whose
 * answer only changes when someone rebuilds the image. The TTL is what lets a
 * rebuild be picked up without a restart.
 */
let cachedSnapshot: { name: string; expires: number } | null = null
const SNAPSHOT_TTL_MS = 5 * 60_000

export async function getActiveSnapshotName(
  daytona: import("@daytonaio/sdk").Daytona
): Promise<string> {
  if (cachedSnapshot && cachedSnapshot.expires > Date.now()) return cachedSnapshot.name

  for (const name of ALL_SNAPSHOT_NAMES) {
    try {
      const snapshot = await daytona.snapshot.get(name)
      if (snapshot.state === SNAPSHOT_STATE_ACTIVE) {
        cachedSnapshot = { name, expires: Date.now() + SNAPSHOT_TTL_MS }
        return name
      }
      // exists but not ready (building/removing/error) — skip it
    } catch {
      // doesn't exist, try next
    }
  }
  throw new Error(
    `No active snapshot found. Run "npm run build:snapshot" to build it.`
  )
}

/**
 * Resource limits for the snapshot.
 * - cpu: vCPUs
 * - memory: GB of RAM
 * - disk: GB of disk
 */
export const SNAPSHOT_RESOURCES = {
  cpu: 1,
  memory: 3, // 3GB RAM
  disk: 5, // 5GB disk
} as const

/**
 * NPM packages to pre-install for each agent CLI.
 * Goose uses a binary download, not npm.
 */
export const AGENT_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  copilot: "@github/copilot",
  kilo: "@kilocode/cli",
  kimi: "", // kimi uses a shell script installer, not npm
  opencode: "opencode-ai",
  gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent",
} as const

/**
 * tokscale CLI version, pinned for reproducible snapshots and a stable
 * `tokscale models --json` output shape. Used for post-turn token/cost
 * metering — it reads each agent's native session files in the sandbox and
 * reports token counts + cost per session/model (pricing bundled in the
 * binary, so the web app owns no pricing code).
 *
 * The npm `tokscale` package is a thin alias for `@tokscale/cli`, whose binary
 * ships via platform optionalDependencies (`@tokscale/cli-linux-x64-gnu` on
 * this glibc/x64 image). A plain `npm install -g` therefore fully embeds the
 * binary at build time — no runtime download.
 */
export const TOKSCALE_VERSION = "3.1.2"

/**
 * Pinned version for every agent CLI installed from npm.
 *
 * These are pinned for the same reason TOKSCALE_VERSION is, and the reason is
 * worth stating because an unpinned install *looks* like it keeps the image
 * current when it does the opposite. `npm install -g <pkg>` is a constant
 * command string, so the build cache reuses that layer on every rebuild and
 * never re-resolves `latest`. Each CLI freezes at whatever version it had the
 * first time its layer was built, and no amount of rebuilding moves it.
 *
 * It went unnoticed until a server-side gate made it visible: a snapshot
 * rebuilt on 2026-08-18 was still serving opencode-ai@1.17.14 (published
 * 2026-07-06), and OpenCode's free tier refuses anything older than
 * MIN_OPENCODE_VERSION. Every free-tier run died on a version error that
 * rebuilding could not clear. Every other CLI was stale too — silently, because
 * nothing was checking their versions.
 *
 * Bumping a version here changes the command string, which is what actually
 * invalidates the layer. Treat this map as the upgrade mechanism: to move an
 * agent, edit its version and rebuild.
 */
export const AGENT_CLI_VERSIONS: Record<string, string> = {
  "@anthropic-ai/claude-code": "2.1.280",
  "@openai/codex": "0.155.1",
  "@github/copilot": "1.0.87",
  "@kilocode/cli": "7.7.7",
  "opencode-ai": "1.18.32",
  "@google/gemini-cli": "0.60.0",
  "@mariozechner/pi-coding-agent": "0.73.1",
}

/**
 * The oldest OpenCode its free tier will serve. Below this the provider
 * rejects the run rather than degrading, so it is a build-time constraint
 * rather than something the app can recover from.
 */
export const MIN_OPENCODE_VERSION = "1.18.0"

/**
 * The install command for one agent CLI, with its version in the string.
 *
 * Throws rather than falling back to an unpinned install: a new agent added
 * without a pin should fail the build loudly, not quietly reintroduce the
 * freeze this map exists to prevent.
 */
export function agentInstallCommand(pkg: string): string {
  const version = AGENT_CLI_VERSIONS[pkg]
  if (!version) throw new Error(`No pinned version for ${pkg} — add one to AGENT_CLI_VERSIONS`)
  return `npm install -g ${pkg}@${version}`
}

/**
 * Headless browser runtime, for agents and scripts that drive a real browser
 * (Selenium, Playwright-style scraping, anything that has to log into a site
 * that offers no API).
 *
 * chromium and chromium-driver are installed in ONE apt transaction on
 * purpose. Selenium refuses to start a session when the driver's major version
 * does not match the browser — "This version of ChromeDriver only supports
 * Chrome version N" — and Debian builds both from the same source, so a single
 * transaction makes the match structural rather than a thing to re-verify.
 * Two separate layers could resolve against different index states.
 */
export const BROWSER_APT_PACKAGES = ["chromium", "chromium-driver"] as const

/**
 * Bump this date to force the browser layer to rebuild.
 *
 * apt cannot be pinned the way npm can: an exact `chromium=153.0.8010.52`
 * breaks the build the moment that version leaves the mirror, which for
 * security updates is weeks. So the layer floats, and this token is the
 * deliberate cache key — changing it changes the command string, which is the
 * only thing that actually invalidates a cached layer. Without it the browser
 * would freeze at its first-built version exactly like the agent CLIs did.
 */
export const BROWSER_LAYER_PIN = "2026-09-22"

/** Where Debian puts them. Knowing the paths avoids a runtime driver download. */
export const CHROMIUM_BIN = "/usr/bin/chromium"
export const CHROMEDRIVER_BIN = "/usr/bin/chromedriver"

/**
 * Python packages available to sandbox scripts, pinned for the same reason the
 * agent CLIs are.
 *
 * selenium and webdriver-manager are imported at module level by the pricing
 * bot, so a missing one is an ImportError before any runtime flag can help —
 * webdriver-manager is present for that import even though the system driver
 * at CHROMEDRIVER_BIN is what should actually be used. pandas and openpyxl
 * read the supplier spreadsheets.
 */
export const PYTHON_PACKAGES: Record<string, string> = {
  selenium: "4.49.0",
  "webdriver-manager": "4.1.2",
  pandas: "3.0.6",
  openpyxl: "3.1.5",
}

/** Install the browser and its matching driver, plus the fonts pages need. */
export function browserInstallCommand(): string {
  // The pin token rides as a comment: it changes the command string (busting
  // the layer) without changing what apt actually does.
  return (
    `: browser layer pin ${BROWSER_LAYER_PIN} && ` +
    "apt-get update && apt-get install -y --no-install-recommends " +
    `${BROWSER_APT_PACKAGES.join(" ")} ` +
    // Without a font package chromium renders boxes, which silently corrupts
    // anything that screenshots or prints to PDF.
    "fonts-liberation fonts-dejavu-core " +
    "&& rm -rf /var/lib/apt/lists/*"
  )
}

/** Install the pinned Python packages into the system interpreter. */
export function pythonInstallCommand(): string {
  const pins = Object.entries(PYTHON_PACKAGES)
    .map(([name, version]) => `${name}==${version}`)
    .join(" ")
  // bookworm ships PEP 668, so pip refuses to touch the system interpreter
  // without this flag. The sandbox is disposable and single-purpose, so a
  // virtualenv would only add a path every script has to know about.
  return `python3 -m pip install --no-cache-dir --break-system-packages ${pins}`
}

/**
 * Builds the Daytona Image spec with all agent CLIs pre-installed.
 *
 * Pre-installed agents:
 * - Claude (@anthropic-ai/claude-code)
 * - Codex (@openai/codex)
 * - Copilot (@github/copilot)
 * - Kilo (@kilocode/cli)
 * - OpenCode (opencode-ai)
 * - Gemini (@google/gemini-cli)
 * - Pi (@mariozechner/pi-coding-agent)
 * - Goose (binary from GitHub releases)
 * - Kimi (shell-script installer from code.kimi.com)
 * - Droid (Factory, shell-script installer from app.factory.ai/cli)
 *
 * Also pre-installs tokscale (token/cost metering CLI; see TOKSCALE_VERSION).
 *
 * Note: Eliza is built-in to the agents package (no CLI installation needed).
 */
export function getAgentSandboxImage(): Image {
  return (
    Image.base("node:22-bookworm")
      .runCommands(
        // Install system dependencies (curl for Goose download, git for agents, sudo for user)
        "apt-get update && apt-get install -y --no-install-recommends " +
          // python3-pip: the base node image has python3 but no pip, so
          // pythonInstallCommand() below has nothing to run without it.
          "curl ca-certificates git bzip2 sudo python3-pip " +
          "&& rm -rf /var/lib/apt/lists/*"
      )
      .runCommands(
        // Headless browser + matching driver. See browserInstallCommand().
        browserInstallCommand()
      )
      .runCommands(
        // Python packages for scripts that drive the browser.
        pythonInstallCommand()
      )
      .runCommands(
        // Install Claude Code CLI
        agentInstallCommand("@anthropic-ai/claude-code")
      )
      .runCommands(
        // Install Codex CLI
        agentInstallCommand("@openai/codex")
      )
      .runCommands(
        // Install Gemini CLI
        agentInstallCommand("@google/gemini-cli")
      )
      .runCommands(
        // Install OpenCode CLI
        agentInstallCommand("opencode-ai")
      )
      .runCommands(
        // Install Pi CLI
        agentInstallCommand("@mariozechner/pi-coding-agent")
      )
      .runCommands(
        // Install GitHub Copilot CLI
        agentInstallCommand("@github/copilot")
      )
      .runCommands(
        // Install Kilo CLI
        agentInstallCommand("@kilocode/cli")
      )
      // Create daytona user (non-root) - Claude Code refuses to run as root.
      // Must come before the Kimi install below, which chowns its output to
      // the daytona user (and uses /home/daytona as HOME).
      .runCommands(
        "useradd -m -s /bin/bash daytona || true && " +
          "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers"
      )
      .runCommands(
        // Install Kimi Code CLI (Moonshot). Shell-script installer, not npm —
        // run with HOME pointed at the daytona user so the `kimi` binary lands
        // in /home/daytona/.kimi-code/bin, then hand ownership to the daytona
        // user. KIMI_NO_MODIFY_PATH avoids the installer editing .profile; the
        // dir is added to PATH via .bashrc below.
        "export HOME=/home/daytona KIMI_NO_MODIFY_PATH=1 && " +
          "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash && " +
          "chown -R daytona:daytona /home/daytona/.kimi-code"
      )
      .runCommands(
        // Install Factory Droid CLI. Shell-script installer, not npm — run with
        // HOME pointed at the daytona user so the `droid` binary lands in
        // /home/daytona/.local/bin (already on PATH via .bashrc below), then hand
        // ownership to the daytona user.
        "export HOME=/home/daytona && " +
          "curl -fsSL https://app.factory.ai/cli | sh && " +
          "chown -R daytona:daytona /home/daytona/.local /home/daytona/.factory 2>/dev/null || true"
      )
      .runCommands(
        // Install tokscale (token/cost metering). Binary embeds at build time
        // via @tokscale/cli's platform optionalDependency — no runtime download.
        `npm install -g tokscale@${TOKSCALE_VERSION}`
      )
      // Install Goose binary
      .runCommands(
        "mkdir -p /home/daytona/.local/bin /tmp/goose_tmp && " +
          'curl -fsSL "https://github.com/block/goose/releases/download/stable/goose-x86_64-unknown-linux-gnu.tar.bz2" | ' +
          "tar -xjf - --no-same-owner --no-same-permissions -C /tmp/goose_tmp && " +
          "mv /tmp/goose_tmp/goose /home/daytona/.local/bin/goose && " +
          "chmod +x /home/daytona/.local/bin/goose && " +
          "rm -rf /tmp/goose_tmp"
      )
      // Create required directories and set up PATH for daytona user
      .runCommands(
        "mkdir -p /home/daytona/.gemini /home/daytona/.config/goose /home/daytona/project && " +
          "chown -R daytona:daytona /home/daytona"
      )
      // Pre-install ws + node-pty for @switchboard/sandbox-terminal so
      // setupTerminal() finds them already present at /opt/pty-server and
      // skips its runtime install step. Path and versions must match what
      // sandbox-terminal/src/sandbox/setup.ts and
      // sandbox-terminal/src/server/pty-server.ts expect.
      .runCommands(
        "mkdir -p /opt/pty-server && " +
          "cd /opt/pty-server && " +
          "npm install --prefix /opt/pty-server ws@^8.18.0 node-pty@^1.0.0 && " +
          "chown -R daytona:daytona /opt/pty-server"
      )
      .runCommands(
        'echo \'export PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$PATH"\' >> /home/daytona/.bashrc'
      )
      // Set the default user to daytona
      .dockerfileCommands(["USER daytona"])
      .workdir("/home/daytona/project")
  )
}
