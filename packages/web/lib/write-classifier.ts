import type { ToolCall } from "@switchboard/common"

/**
 * Which tool calls changed something outside the sandbox.
 *
 * Every external write the agents make is a shell command: a script run with
 * `--apply`, a `curl -X POST` against a workspace API, a Python heredoc calling
 * the `_http.request("POST", …)` helper. Rendered as chips they look like every
 * read, which is why people asked "did you actually do it" four times in two
 * months. This tags them at parse time so the transcript and the workspace
 * feed can say what was written, where, and what came back.
 *
 * It is a classifier over command text, so it errs towards tagging: a tagged
 * read costs one spurious line; an untagged write costs the audit trail.
 */
export interface WriteSignal {
  /** HTTP method, "apply" for a script's --apply flag, "run" for a script that writes by default. */
  verb: string
  /** What was written to: a URL path with its env-var base, or a script invocation. */
  target: string
}

export interface WriteOutcome {
  count?: number
  label?: string
  status?: number
}

const SHELL_TOOLS = new Set(["Bash", "bash", "shell", "execute", "run_command", "terminal"])

/** Instantly's v2 API lists with POST. These paths read. */
const POST_READS = /\/(list|search|analytics(\/[a-z-]+)?|count|export)(\?|"|'|\s|$)/

/** Scripts that write unless told not to. */
const WRITES_BY_DEFAULT = /\b(crm_pricing_bot\.py)\b/

const HTTP_VERB = /(?:^|\s)(?:-X|--request)[\s=]+(POST|PUT|PATCH|DELETE)\b/i
const URL_TOKEN = /(?:"|')?((?:\$\{?[A-Z_]+\}?|https?:\/\/[^\s"'/]+)(\/[^\s"'<>]*)?)/g
/**
 * Any helper called with a write verb and a literal or f-string path:
 * `request("POST", f"{base}/campaigns/{cid}/activate", tok)`, `call("POST",
 * "/api/run", body)`. The path may carry any number of `{…}` placeholders.
 */
const PY_VERB_CALL = /\b\w+\(\s*["'](POST|PUT|PATCH|DELETE)["']\s*,\s*f?["']([^"'\n]+)["']/gi
/** `urllib.request.Request(<url expr>, …)`, up to the end of its argument list. */
const URLLIB_REQUEST = /Request\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g

function stripRedirects(cmd: string): string {
  return cmd.replace(/\s2>&1|\s\|\s*(tee|tail|head)\b[^&|;]*/g, "")
}

function scriptWrite(cmd: string): WriteSignal | null {
  // One statement at a time, so `--json` on a dry run in a chain of commands
  // cannot borrow an `--apply` from a later one.
  for (const part of cmd.split(/&&|\|\||;|\n/)) {
    const m = /python3?\s+(?:[\w./-]*\/)?([\w-]+\.py)((?:\s+(?!2>)[^\s|&;]+)*)/.exec(part)
    if (!m) continue
    const [, script, rawArgs] = m
    const args = (rawArgs ?? "").trim().split(/\s+/).filter(Boolean)
    if (args.includes("--apply")) {
      const kept = args.filter((a) => a !== "--apply" && !a.startsWith("--healthy") && !/^\d?>/.test(a))
      // Flags after --apply that only shape output are noise in a receipt.
      const target = [script, ...kept.filter((a) => !["--json", "--by", "switchboard", "agent"].includes(a))]
        .join(" ")
        .trim()
      return { verb: "apply", target }
    }
    if (WRITES_BY_DEFAULT.test(script) && !args.includes("--dry-run")) {
      return { verb: "run", target: script }
    }
  }
  return null
}

function targetFromUrl(url: string): string {
  const m = /^https?:\/\/([^/]+)(\/.*)?$/.exec(url)
  if (m) return m[1] + (m[2] ?? "")
  return url
}

function curlWrite(cmd: string): WriteSignal | null {
  // One curl invocation at a time. A command often chains a POST-shaped list
  // read with a later GET, or a write with a later read; pairing the verb of
  // one with the URL of another mislabelled both kinds.
  const pieces = stripRedirects(cmd).split(/(?=\bcurl\s)/)
  for (const piece of pieces) {
    if (!/^curl\s/.test(piece)) continue
    const verb = HTTP_VERB.exec(piece)
    if (!verb) continue
    const url = [...piece.matchAll(URL_TOKEN)]
      .map((m) => m[1])
      .find((u) => (u.startsWith("$") && /\$\{?[A-Z_]+\}?\//.test(u)) || u.startsWith("http"))
    if (!url || POST_READS.test(url + " ")) continue
    return { verb: verb[1].toUpperCase(), target: targetFromUrl(url) }
  }
  return null
}

/** Strip a leading `{base}`-style placeholder so the target reads as a path. */
function pathOf(raw: string): string {
  return raw.trim().replace(/^\{[^}]*\}/, "")
}

function pythonWrite(cmd: string): WriteSignal | null {
  for (const m of cmd.matchAll(PY_VERB_CALL)) {
    const path = pathOf(m[2])
    if (!path || POST_READS.test(path + " ")) continue
    return { verb: m[1].toUpperCase(), target: path }
  }
  for (const m of cmd.matchAll(URLLIB_REQUEST)) {
    const args = m[1]
    const method = /method\s*=\s*["'](\w+)["']/.exec(args)?.[1]?.toUpperCase()
    // urllib sends a POST when it is given data and no method.
    const verb = method ?? (/\bdata\s*=/.test(args) ? "POST" : "GET")
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(verb)) continue
    // Only a literal path in the URL argument says where it goes. A bare
    // variable (`Request(url, data=…)`) is a generic helper used for reads and
    // writes alike; its literal-path callers are caught above.
    const urlArg = args.split(/,\s*(?:data|method|headers)\s*=/)[0]
    // The last literal that is more than a bare slash is the path: the URL is
    // usually `base.rstrip('/') + '/api/enrich'` or `f"{base}/api/enrich"`.
    const literal = [...urlArg.matchAll(/f?["']([^"']*\/[^"']*)["']/g)]
      .map((x) => x[1])
      .filter((x) => x.trim() !== "/")
      .pop()
    if (!literal) continue
    const path = pathOf(literal)
    if (POST_READS.test(path + " ")) continue
    return { verb, target: path }
  }
  return null
}

export function classifyWrite(toolName: string, input: unknown): WriteSignal | null {
  if (!SHELL_TOOLS.has(toolName)) return null
  if (!input || typeof input !== "object") return null
  const command = (input as Record<string, unknown>).command
  if (typeof command !== "string" || !command.trim()) return null
  return scriptWrite(command) ?? curlWrite(command) ?? pythonWrite(command)
}

/** What a source file would write if run, or null when it only reads. */
function writesInSource(source: string): WriteSignal | null {
  return pythonWrite(source) ?? curlWrite(source)
}

const HEREDOC_FILE = /cat\s*>\s*(\S+\.(?:py|sh))\s*<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\2\b/g
const RUN_FILE = /\b(?:python3?|bash|sh)\s+(\S+\.(?:py|sh))\b/g

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

/**
 * Per-turn memory for the one write the single-call classifier cannot see: an
 * agent writes a driver script to a file (a heredoc or the Write tool) and runs
 * it in a later call. On 2026-10-14 four paid /api/run and /api/enrich drivers
 * ran that way with nothing to show they wrote anything.
 */
export class WriteTracker {
  private scripts = new Map<string, WriteSignal>()

  observe(toolName: string, input: unknown): WriteSignal | null {
    if (!input || typeof input !== "object") return null
    const inp = input as Record<string, unknown>

    if (toolName === "Write" && typeof inp.file_path === "string" && typeof inp.content === "string") {
      this.remember(inp.file_path, inp.content)
      return null
    }

    const direct = classifyWrite(toolName, input)
    if (!SHELL_TOOLS.has(toolName) || typeof inp.command !== "string") return direct
    const command = inp.command

    let wroteFile = false
    for (const m of command.matchAll(HEREDOC_FILE)) {
      this.remember(m[1], m[3])
      wroteFile = true
    }
    // The heredoc body is source, not a call made now; judge it when it runs.
    const outsideHeredocs = wroteFile ? command.replace(HEREDOC_FILE, "") : command
    const now = wroteFile ? classifyWrite(toolName, { command: outsideHeredocs }) : direct
    if (now) return now

    for (const m of outsideHeredocs.matchAll(RUN_FILE)) {
      const inner = this.scripts.get(m[1]) ?? this.scripts.get(basename(m[1]))
      if (inner) return { verb: "run", target: `${basename(m[1])} (${inner.verb} ${inner.target})` }
    }
    return null
  }

  private remember(path: string, source: string) {
    const inner = writesInSource(source)
    if (inner) {
      this.scripts.set(path, inner)
      this.scripts.set(basename(path), inner)
    }
  }
}

const COUNT_KEYS = ["leads_uploaded", "pushed", "enrolled", "updated", "queued", "created", "deleted", "removed"]

/** What the write reported back, when the output carries a count or a code. */
export function writeOutcome(output: string | undefined): WriteOutcome | null {
  if (!output) return null
  for (const key of COUNT_KEYS) {
    const m = new RegExp(`"?${key}"?\\s*:\\s*(\\d+)`).exec(output)
    if (m) return { count: Number(m[1]), label: key }
  }
  const status = /\bHTTP[:\s]+(\d{3})\b/.exec(output)
  if (status) return { status: Number(status[1]) }
  return null
}

/** One line per write, for the transcript and the workspace feed. */
export function summarizeWrites(toolCalls: ToolCall[]): string[] {
  const lines: string[] = []
  for (const call of toolCalls) {
    if (!call.write) continue
    const outcome = writeOutcome(call.output)
    let line = `${call.write.verb} ${call.write.target}`
    if (outcome?.count !== undefined) line += ` → ${outcome.label} ${outcome.count}`
    else if (outcome?.status !== undefined) line += ` → HTTP ${outcome.status}`
    lines.push(line)
  }
  return lines
}
