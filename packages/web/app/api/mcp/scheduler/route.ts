import type { NextRequest } from "next/server"
import { addMinutes } from "date-fns"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db/prisma"
import { bearerFrom, verifyRunToken, type RunTokenClaims } from "@/lib/mcp/run-token"
import { notifyAsync } from "@/lib/db/notifications"
import {
  MAX_AGENT_JOBS_PER_WORKSPACE,
  MIN_INTERVAL_MINUTES,
  describeInterval,
  normalizeInterval,
} from "@/lib/scheduled-jobs/agent-proposal"

/**
 * An MCP server the agent in a sandbox can call, over Streamable HTTP.
 *
 * Hand-rolled rather than built on the SDK: its transport is written for a
 * long-lived process holding session state, and this runs on serverless. The
 * spec lets a server answer a POST with a plain JSON body when it has nothing
 * to stream, which is every call here — so the whole thing is stateless, which
 * is the only shape that survives a cold start between two tool calls.
 *
 * One tool, and it cannot start anything. `create_scheduled_job` writes a job
 * that is disabled and unapproved; a person approves it before it ever runs.
 * That is deliberate: the caller is an agent reading attacker-influenceable
 * text while holding workspace credentials, and a schedule is persistence —
 * without the gate, one injected page could leave behind a job that keeps
 * running long after the chat that created it is closed.
 */

const PROTOCOL_VERSION = "2025-06-18"

// =============================================================================
// JSON-RPC plumbing
// =============================================================================

interface RpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function result(id: string | number | null | undefined, value: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: value })
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string
): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })
}

/**
 * A tool failure is a *result* with isError, not a JSON-RPC error. Protocol
 * errors mean "the call was malformed"; this means "the call was fine and the
 * answer is no", and the model needs to read the reason to act on it.
 */
function toolFailure(id: string | number | null | undefined, message: string): Response {
  return result(id, { isError: true, content: [{ type: "text", text: message }] })
}

function toolText(id: string | number | null | undefined, text: string): Response {
  return result(id, { isError: false, content: [{ type: "text", text }] })
}

// =============================================================================
// Tool definition
// =============================================================================

const CREATE_JOB_TOOL = {
  name: "create_scheduled_job",
  title: "Propose a recurring job",
  description:
    "Propose a recurring agent run in the current workspace — a weekly audit, a daily check, " +
    "anything that should happen on a schedule rather than once. The job is created awaiting " +
    "approval and does NOT run until a person approves it in the Scheduled tab; say so when " +
    "you report back. Ask the user for anything you are missing before calling this: what the " +
    "run should actually do, and how often. Do not guess an interval.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short name for the job, e.g. 'Weekly campaign audit'. Max 100 characters.",
      },
      prompt: {
        type: "string",
        description:
          "The full instruction the scheduled run will be given. Write it standalone — it runs " +
          "with no memory of this conversation. Name the scripts to run and what to report.",
      },
      intervalMinutes: {
        type: "integer",
        description:
          `How often to run, in minutes. Minimum ${MIN_INTERVAL_MINUTES}. Common values: ` +
          "1440 (daily), 10080 (weekly), 20160 (fortnightly). Ask the user rather than assuming.",
      },
    },
    required: ["name", "prompt", "intervalMinutes"],
    additionalProperties: false,
  },
} as const

// =============================================================================
// create_scheduled_job
// =============================================================================

async function createScheduledJob(
  claims: RunTokenClaims,
  args: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const name = typeof args.name === "string" ? args.name.trim() : ""
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : ""
  const rawInterval = args.intervalMinutes

  if (!name) return { ok: false, text: "A name is required." }
  if (name.length > 100) return { ok: false, text: "That name is too long (max 100 characters)." }
  if (!prompt) return { ok: false, text: "A prompt is required — say what the run should do." }

  const interval = normalizeInterval(rawInterval)
  if (!interval.ok) return { ok: false, text: interval.reason }

  if (!claims.workspaceId) {
    return {
      ok: false,
      text:
        "This run is not bound to a workspace, so there is nowhere to put a scheduled job. " +
        "Ask the user to open a workspace first.",
    }
  }

  // Membership, again, at call time. The token says which workspace the run
  // belongs to; it does not say the user is still in it. A run outlives the
  // membership that started it, and this is the boundary that matters.
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: claims.workspaceId, userId: claims.userId } },
    select: { role: true },
  })
  if (!member) {
    return { ok: false, text: "You are no longer a member of this workspace." }
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: claims.workspaceId, archived: false },
    select: { id: true, name: true, repo: true, baseBranch: true, agent: true, model: true },
  })
  if (!workspace) return { ok: false, text: "That workspace no longer exists." }

  // A cap on unapproved jobs, per workspace. Without it a looping agent can
  // fill someone's approval queue faster than they can read it, which is a
  // denial of attention even though nothing runs.
  const pending = await prisma.scheduledJob.count({
    where: { workspaceId: workspace.id, approvedAt: null, isDraft: false },
  })
  if (pending >= MAX_AGENT_JOBS_PER_WORKSPACE) {
    return {
      ok: false,
      text:
        `There are already ${pending} jobs waiting for approval in ${workspace.name}. ` +
        "Ask the user to approve or discard those before proposing another.",
    }
  }

  const job = await prisma.scheduledJob.create({
    data: {
      userId: claims.userId,
      workspaceId: workspace.id,
      name,
      prompt,
      // Denormalised from the workspace exactly as the form does it.
      repo: workspace.repo,
      baseBranch: workspace.baseBranch,
      agent: workspace.agent,
      model: workspace.model,
      triggerType: "interval",
      incomingToken: randomUUID(),
      intervalMinutes: interval.minutes,
      // Off and unapproved. The cron filters on both, so neither alone is
      // load-bearing — but `enabled` is what a person toggles later, and
      // `approvedAt` is what says nobody has looked yet.
      enabled: false,
      approvedAt: null,
      nextRunAt: addMinutes(new Date(), interval.minutes),
      autoPR: false,
      continueFromLastRun: false,
      isDraft: false,
    },
    select: { id: true, name: true },
  })

  // The person has to know something is waiting on them, or the gate just
  // means the job silently never runs.
  notifyAsync({
    userId: claims.userId,
    kind: "scheduled_job_proposed",
    title: "A scheduled job needs your approval",
    body: `"${job.name}" — ${describeInterval(interval.minutes)}, in ${workspace.name}`,
    chatId: claims.chatId ?? undefined,
    workspaceId: workspace.id,
  })

  return {
    ok: true,
    text:
      `Proposed "${job.name}" in ${workspace.name}, ${describeInterval(interval.minutes)}.\n\n` +
      "It is NOT running yet — it is waiting for approval in the Scheduled tab. " +
      "Tell the user they need to approve it there before it will do anything.",
  }
}

// =============================================================================
// Handler
// =============================================================================

export async function POST(req: NextRequest): Promise<Response> {
  const claims = verifyRunToken(bearerFrom(req.headers.get("authorization")))
  if (!claims) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    })
  }

  let body: RpcRequest
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, "Parse error")
  }
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id, -32600, "Invalid Request")
  }

  // Notifications carry no id and expect no body — answering one with a
  // result makes strict clients drop the connection.
  const isNotification = body.id === undefined || body.id === null

  switch (body.method) {
    case "initialize":
      return result(body.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shared-agents-scheduler", version: "1.0.0" },
      })

    case "notifications/initialized":
    case "notifications/cancelled":
      return new Response(null, { status: 202 })

    case "ping":
      return result(body.id, {})

    case "tools/list":
      return result(body.id, { tools: [CREATE_JOB_TOOL] })

    case "tools/call": {
      const params = body.params ?? {}
      if (params.name !== CREATE_JOB_TOOL.name) {
        return rpcError(body.id, -32602, `Unknown tool: ${String(params.name)}`)
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>
      try {
        const outcome = await createScheduledJob(claims, args)
        return outcome.ok ? toolText(body.id, outcome.text) : toolFailure(body.id, outcome.text)
      } catch (err) {
        console.error("[mcp/scheduler] create_scheduled_job failed:", err)
        return toolFailure(body.id, "Could not create the job. Tell the user to add it manually.")
      }
    }

    default:
      if (isNotification) return new Response(null, { status: 202 })
      return rpcError(body.id, -32601, `Method not found: ${body.method}`)
  }
}

/**
 * Some clients probe with GET to open a server-initiated stream. This server
 * never initiates anything, so it declines rather than holding a connection
 * open that a serverless function would bill for and then time out.
 */
export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } })
}
