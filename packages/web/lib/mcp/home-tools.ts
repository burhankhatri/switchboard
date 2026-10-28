import { prisma } from "@/lib/db/prisma"
import type { RunTokenClaims } from "./run-token"
import { createWidget, updateWidget, type WidgetActor } from "@/lib/workspace-home/widget-store"
import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TIMELINE_EVENTS,
  MAX_WIDGETS_PER_WORKSPACE,
  WIDGET_TYPES,
} from "@/lib/workspace-home/widgets"

/**
 * Home-page tools for the agent, served by the same run-scoped MCP endpoint as
 * the scheduler.
 *
 * Unlike a schedule, a widget is not persistence that acts — it is text on a
 * page — so it appears without approval. What keeps that safe is upstream:
 * the content is validated against a fixed catalogue (no markup, no fetched
 * URLs), every widget names the chat or job that wrote it, and any member can
 * remove it.
 */

export type ToolOutcome = { ok: true; text: string } | { ok: false; text: string }

// The first home page an agent built from the bare catalogue was eight cards of
// paragraphs. The guide steers toward shapes a glance can read, and says so
// plainly, because the model follows what the tool description tells it.
const CONTENT_GUIDE =
  "How to compose a home page: it is read in seconds by people who never open a chat, so show, " +
  "don't tell. Lead with one summary (key \"summary\"), then kpis, then charts, funnels, " +
  "timelines and actions; use a table only for a list people scan; use note only for what has " +
  "no other shape, and keep it under 60 words. Every text field is one short line. Put the date " +
  "range in titles or asOf. tone is good|warn|bad|info and marks how a point reads.\n\n" +
  "content depends on type, and must contain only these fields:\n" +
  "- summary: { headline: one sentence on where things stand, points?: [{ text, tone? }] (max 5), asOf? }\n" +
  '- kpis: { items: [{ label, value: number|string, unit?, change?: { value: "+18%", direction: "up"|"down"|"flat" }, hint? }] (1–6), asOf?, note?, link? } — prefer this to several stat widgets\n' +
  '- stat: { value: number|string, unit?, change?: { value: "+18%", direction: "up"|"down"|"flat" }, note?, link? }\n' +
  "- funnel: { steps: [{ label, value: number }] (2–8, largest first), note?, link? } — a pipeline; conversion between steps is shown for you\n" +
  `- timeline: { events: [{ date: "25 Sep", title, detail?, who?, tone? }] (newest first, max ${MAX_TIMELINE_EVENTS}) }\n` +
  '- actions: { items: [{ title, detail?, owner?: who it waits on, urgency?: "now"|"soon"|"fyi", since? }] (max 10) } — what needs a person\n' +
  `- table: { columns: string[] (max ${MAX_TABLE_COLUMNS}), rows: (string|number|null)[][] (max ${MAX_TABLE_ROWS}, one cell per column), note?, link? }\n` +
  `- chart: { kind: "line"|"bar", labels: string[], series: [{ name, values: (number|null)[] }] (max ${MAX_CHART_SERIES} series, ${MAX_CHART_POINTS} points in total, one value per label), yLabel?, note?, link? }\n` +
  "- file: { path } — a file inside this workspace folder, repo-relative\n" +
  "- job: { jobId } — a scheduled job in this workspace\n" +
  "- note: { markdown } — plain Markdown; HTML is not rendered\n" +
  "The optional note field on other types is one short line of context; link must be an " +
  'http(s) URL. In a table, a column named "Status" shows as coloured pills and numeric ' +
  "columns get inline bars, so keep numbers as numbers or plain percentages."

export const PIN_TO_HOME_TOOL = {
  name: "pin_to_home",
  title: "Pin a widget to the workspace home page",
  description:
    "Add a card to this workspace's home page, which every member sees — including people who " +
    "never open a chat. Use it for results worth glancing at: a headline number, a short table, " +
    "a trend, a key file. It appears immediately and is labelled with where it came from.\n\n" +
    `Give it a stable key (e.g. "weekly-leads") when it should be kept up to date: a scheduled ` +
    "job can then refresh it with update_home_widget using that key, and you should write the " +
    `key into the job's prompt. A workspace holds at most ${MAX_WIDGETS_PER_WORKSPACE} widgets; ` +
    "update an existing one rather than adding near-duplicates.\n\n" +
    CONTENT_GUIDE,
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: [...WIDGET_TYPES] },
      title: { type: "string", description: "Short card title, max 120 characters." },
      key: {
        type: "string",
        description: "Optional stable name: lowercase letters, digits and dashes.",
      },
      content: { type: "object", description: "See the tool description for each type's shape." },
    },
    required: ["type", "title", "content"],
    additionalProperties: false,
  },
} as const

export const UPDATE_HOME_WIDGET_TOOL = {
  name: "update_home_widget",
  title: "Update a widget on the workspace home page",
  description:
    "Replace the content (and optionally the title) of an existing home-page widget, by its key " +
    "or id. Use this from scheduled jobs to keep numbers current. The content must match the " +
    "widget's type; pass type as well to turn the widget into another kind where it already " +
    "sits (a note that lists dates into a timeline, say) rather than pinning a duplicate.\n\n" +
    CONTENT_GUIDE,
  inputSchema: {
    type: "object",
    properties: {
      widget: { type: "string", description: "The widget's key (preferred) or id." },
      title: { type: "string" },
      type: {
        type: "string",
        enum: [...WIDGET_TYPES],
        description: "Only to change the widget's kind; content must then be in the new shape.",
      },
      content: { type: "object" },
    },
    required: ["widget"],
    additionalProperties: false,
  },
} as const

/**
 * Resolve the run's workspace and re-check membership, at call time. A run
 * outlives the membership that started it, and a scheduled run acts as the
 * job's author, who may since have left.
 */
async function runWorkspace(
  claims: RunTokenClaims
): Promise<{ ok: true; workspace: { id: string; path: string } } | { ok: false; text: string }> {
  if (!claims.workspaceId) {
    return {
      ok: false,
      text: "This run is not bound to a workspace, so there is no home page to put this on.",
    }
  }
  const workspace = await prisma.workspace.findFirst({
    where: { id: claims.workspaceId, archived: false },
    select: {
      id: true,
      path: true,
      members: { where: { userId: claims.userId }, select: { role: true } },
    },
  })
  if (!workspace) return { ok: false, text: "That workspace no longer exists." }
  if (workspace.members.length === 0) {
    return { ok: false, text: "You are no longer a member of this workspace." }
  }
  return { ok: true, workspace: { id: workspace.id, path: workspace.path } }
}

function actorFrom(claims: RunTokenClaims): WidgetActor {
  return {
    userId: claims.userId,
    via: "agent",
    chatId: claims.chatId,
    jobId: claims.jobId ?? null,
    runId: claims.jobRunId ?? null,
  }
}

export async function pinToHome(
  claims: RunTokenClaims,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const ws = await runWorkspace(claims)
  if (!ws.ok) return ws
  const result = await createWidget(
    ws.workspace,
    { type: args.type, title: args.title, content: args.content, key: args.key },
    actorFrom(claims)
  )
  if (!result.ok) return { ok: false, text: result.error }
  const { id, key } = result.value
  return {
    ok: true,
    text:
      `Pinned to the home page (widget id ${id}${key ? `, key "${key}"` : ""}). ` +
      (key
        ? `A scheduled job can keep it current with update_home_widget and widget "${key}".`
        : "Give it a key if it should be refreshed by a scheduled job later."),
  }
}

export async function updateHomeWidget(
  claims: RunTokenClaims,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  if (typeof args.widget !== "string" || !args.widget.trim()) {
    return { ok: false, text: "Say which widget: its key or id." }
  }
  const ws = await runWorkspace(claims)
  if (!ws.ok) return ws
  const result = await updateWidget(
    ws.workspace,
    { idOrKey: args.widget.trim() },
    { title: args.title, content: args.content, type: args.type },
    actorFrom(claims)
  )
  if (!result.ok) {
    return {
      ok: false,
      text:
        result.status === 404
          ? `There is no widget "${args.widget}" on this workspace's home page. Use pin_to_home to create it.`
          : result.error,
    }
  }
  return { ok: true, text: "Updated the widget on the home page." }
}

/**
 * Which tools a run is offered. A scheduled run gets the widget tools only: a
 * job proposing more jobs is persistence chaining with nobody watching, and
 * the approval gate would leave the queue to fill unseen.
 */
export function toolNamesForRun(claims: Pick<RunTokenClaims, "jobId">): string[] {
  const widgets = [PIN_TO_HOME_TOOL.name, UPDATE_HOME_WIDGET_TOOL.name]
  // request_approval needs a person in the chat to click; a scheduled run has
  // none, and would only park itself forever.
  return claims.jobId ? widgets : ["create_scheduled_job", "request_approval", ...widgets]
}
