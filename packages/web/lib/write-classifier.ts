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
const PY_REQUEST = /request\(\s*["'](POST|PUT|PATCH|DELETE)["']\s*,\s*f?["'](?:\{[^}]*\})?([^"'{}]+)["']/i

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
  const verb = HTTP_VERB.exec(cmd)
  if (!verb) return null
  const method = verb[1].toUpperCase()
  const urls = [...stripRedirects(cmd).matchAll(URL_TOKEN)]
    .map((m) => m[1])
    .filter((u) => (u.startsWith("$") && !!/\$\{?[A-Z_]+\}?\//.test(u)) || u.startsWith("http"))
  if (urls.length === 0) return null
  // The URL nearest the verb is the one it applies to; curl takes one URL per
  // call, and a chain of reads followed by one write is the common shape.
  const url = urls[urls.length - 1]
  if (POST_READS.test(url + " ")) return null
  return { verb: method, target: targetFromUrl(url) }
}

function pythonWrite(cmd: string): WriteSignal | null {
  const m = PY_REQUEST.exec(cmd)
  if (!m) return null
  const path = m[2].trim()
  if (POST_READS.test(path + " ")) return null
  return { verb: m[1].toUpperCase(), target: path }
}

export function classifyWrite(toolName: string, input: unknown): WriteSignal | null {
  if (!SHELL_TOOLS.has(toolName)) return null
  if (!input || typeof input !== "object") return null
  const command = (input as Record<string, unknown>).command
  if (typeof command !== "string" || !command.trim()) return null
  return scriptWrite(command) ?? curlWrite(command) ?? pythonWrite(command)
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
