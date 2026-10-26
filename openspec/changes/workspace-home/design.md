## Context

See proposal.md for why. The constraints that shape the approach:

- **Visibility is per user today.** `GET /api/chats` and `GET /api/scheduled-jobs` filter on `userId`. The only workspace-wide view is `/api/workspaces/:id/overview`, which returns the last 10 run statuses with no job names.
- **Home already exists as a component.** `components/chat/HomeView.tsx` renders when a workspace is open and no chat is selected. It reads the `/overview` cache entry so it costs no extra request.
- **The agent already has a callback channel.** `app/api/mcp/scheduler` is a stateless, hand-rolled MCP server that authenticates with a signed run token (`lib/mcp/run-token.ts`: `userId`, `workspaceId`, `chatId`, `exp`). `schedulerMcpServer()` attaches it to interactive runs only. `cron/agent-lifecycle/_lib/scheduled.ts` builds `mcpServers` from `loadMcpConnections({ kind: "job" })` and **does not** attach it.
- **Scheduled runs commit to branches.** With `autoPR`, a job's commits land on a PR branch, not the workspace's base branch, so anything a job writes to the repo is invisible on home until someone merges it.
- **The agent reads attacker-influenceable text** (PROGRESS.md "Known risks"). Anything it can put on a page that other people read must be inert.
- `recharts` and `zod` are already dependencies. Markdown rendering with sanitisation exists for file previews.

## Goals / Non-Goals

**Goals:**
- One gated request loads everything home needs except the brief, matching the `/overview` pattern.
- Widget writes from a person, a chat agent and a scheduled agent go through one validation function.
- Recording an event never fails or slows the action that caused it.

**Non-Goals:**
- Realtime updates. Home refetches on focus and on an interval, as the rest of the app does.
- Per-member widget layouts. There is one home per workspace.
- Backfilling events from before the migration, apart from what can be derived (see Migration Plan).

## Decisions

### 1. The brief lives in the repo; widgets live in the database
`HOME.md` is prose that changes rarely and benefits from history, review and agent editing through the normal file path. It needs no new storage, and the file viewer already renders Markdown.

Widgets are data that refreshes on every run. If they were stored in the repo, each refresh would be a commit, scheduled refreshes would sit on unmerged `autoPR` branches, and the 1 MB Contents limit would apply to reading them. A `WorkspaceWidget` row is updated in place.

*Alternative:* a single `home.yaml` in the repo holding layout and data. Rejected because of the branch problem: a job could never update home without a merge.

### 2. Widgets are a fixed catalogue validated with zod, rendered by our own components
A widget is `{ type, title, content: Json }`, and each type has a zod schema in `lib/workspace-home/widgets.ts` that is shared by the API routes and the MCP tools. Rendering is plain React with `recharts` for charts and the existing sanitised Markdown renderer for notes, so raw HTML is disabled. Nothing the agent writes is interpreted as markup or fetched automatically. Links are rendered as `<a target="_blank" rel="noopener noreferrer">` and only for `http(s):`.

This is the A2UI / json-render pattern: the agent picks from components the client owns.

*Alternatives:* sandboxed HTML widgets (MCP Apps style) give more freedom, but they need iframe isolation, a CSP and a new review surface. Deferred until the catalogue is shown to be too small.

### 3. Widget provenance is stored on the row, not computed
`WorkspaceWidget` stores two sets of fields:
- `createdById` and `createdVia`: `"manual" | "pin" | "agent"`
- `updatedById`, `updatedAt`, `sourceChatId?`, `sourceJobId?` and `sourceRunId?`, set on every content write

The UI derives the line "Updated by Weekly Lead Run · 2h ago" from these fields. The stale check (spec: older than twice the job's interval) reads `sourceJobId` → `ScheduledJob.intervalMinutes`.

A chat source links only when the chat is shared to the workspace. Otherwise the widget shows the member's name and no link, so a widget never leaks the existence of a private chat's content.

### 4. The run token gains the job and run it belongs to; the scheduler endpoint serves both kinds of tool
`RunTokenClaims` gains `jobId?` and `jobRunId?`. Scheduled runs mint a token with them. `schedulerMcpServer()` takes an optional `{ jobId, jobRunId }` and is attached in `_lib/scheduled.ts` the same way it is in the messages route.

`tools/list` depends on the claims:
- Interactive runs get `create_scheduled_job`, `pin_to_home` and `update_home_widget`.
- Scheduled runs get the two widget tools only. A job proposing more jobs is persistence chaining, with no user present to notice it.

Every `tools/call` re-checks that `userId` is a member of `workspaceId` before writing. The spec requires this, and it matches the bind-time-and-run-time rule in `agent-runs`.

*Alternative:* a separate `/api/mcp/home` endpoint. Rejected because it would duplicate the JSON-RPC plumbing and the origin discovery, and the agent would need two servers configured. The route is still named `scheduler`. Renaming it is a separate refactor commit, if anyone wants one.

`update_home_widget` addresses widgets by id. `pin_to_home` returns the id, and the agent is told in the tool description to put that id into the job prompt when it sets up a refreshing job. A widget can also be looked up by `(workspaceId, key)`: the agent may set an optional stable `key` such as `"weekly-leads"` so a job prompt can say "update widget weekly-leads". That is easier for a person reading the prompt than a cuid.

Limits: 40 widgets per workspace and 64 KB of content each. Both are enforced in the shared validator.

### 5. Events are an append-only table written from a single helper, fire-and-forget
`WorkspaceEvent { id, workspaceId, kind, actorUserId?, jobId?, runId?, chatId?, widgetId?, path?, summary, createdAt }`, indexed on `(workspaceId, createdAt)`. `summary` is a short display string frozen at write time ("Weekly Lead Run failed: HubSpot 401"), so the feed renders without joins and still reads correctly after the subject is renamed or deleted.

`recordWorkspaceEvent()` mirrors `notifyAsync`/`logActivityAsync`: it does not throw and is not awaited on the request path.

Call sites:
- job create, approve, update(enabled) and delete in `api/scheduled-jobs`
- run complete/error in `_lib/scheduled.ts`
- file commits in the files, import, edit-text and delete routes, plus run auto-push in the messages route, recorded as one event per commit with a file count rather than one per file
- widget create/update/delete by a person
- member join/leave/add/remove
- chat share

*Why not reuse `ActivityLog`:* it is user-scoped and admin-facing, and adding workspace queries to it would mix an audit trail with a product surface. *Why not `Notification`:* that table holds one row per recipient, with read state.

Chat links in events are resolved at read time against `Chat.sharedToWorkspaceAt`. Unsharing hides the link but keeps the event, as the spec requires.

### 6. "Since you were last here" is a query over events
`WorkspaceMember.lastSeenAt` is read before it is updated:
1. `GET /home` returns `since = lastSeenAt ?? now - 7d` and the summary computed from events after `since`.
2. Then it sets `lastSeenAt = now`, debounced: only if more than 5 minutes have passed since the stored value, so refetch-on-focus does not wipe the summary while the member is still reading it.

The summary is grouped counts by `kind`, plus up to five highlights. Failures come first, then shares, then the newest.

### 7. One `GET /api/workspaces/:id/home` request; the brief is fetched separately
It runs `gateWorkspace` once, then these queries concurrently:
- jobs, with each job's last run and author
- widgets
- the first page of events
- shared chats (up to 10)
- the since-summary

The brief is fetched through the existing file read path. It is a GitHub call with an ETag cache, and folding it in would make the whole page wait on GitHub. That is the reason `/overview` already gives for leaving out the file tree. Older events come from `GET /api/workspaces/:id/events?before=<cursor>`.

### 8. Shared chats reuse the read-only renderer from public share links
`Chat.sharedToWorkspaceAt DateTime?`. When it is set, `GET /api/chats/:chatId` and its messages admit any current member of `chat.workspaceId`, with a fresh membership check on every request. All mutating chat routes keep their owner-only check unchanged. The client renders a non-owner's view with the same read-only components `/share/[shareId]` uses, with no composer.

This is separate from `shareId` (a public link). Sharing to a workspace never creates a public link, and a public link never grants workspace visibility.

### 9. Pin from chat parses on the client and posts typed content
"Pin to Home" on an assistant message:
1. Find the first Markdown table in the message. If there is one, propose a table widget.
2. Otherwise, if the message is a short single figure, propose a stat.
3. Otherwise, propose a note.

The member sees the proposed widget, can edit its title and type, and saves. The server validates it like any other write and stores `sourceChatId`/`sourceMessageId`. No model call is involved.

## Risks / Trade-offs

- **[Risk] Prompt-injected content shown to colleagues who trust it.** A run reading a hostile web page could pin a misleading "note". → Content is inert (Decision 2), every widget carries its source (Decision 3), any member can remove a widget, and removal is recorded in the feed. Text injection itself is not prevented. This is the accepted trade-off for not requiring approval, as the user chose.
- **[Risk] Job prompts and errors may quote sensitive data to all members.** → These are already readable by every member through `/runs` today. The spec makes the existing behaviour explicit rather than widening it.
- **[Risk] Event volume from busy jobs.** A job running every 15 minutes writes about 100 events a day. → Routine widget refreshes write no event. Run events are cheap rows. Retention is an open question, because it does not change the design.
- **[Risk] Scheduled runs gain an MCP server they never had.** A misconfigured origin could now print a warning on every cron tick. → `schedulerMcpServer` already returns null and warns when there is no reachable origin. The run proceeds without tools, which is today's behaviour.
- **[Trade-off] Any member can rearrange or remove anyone's widgets.** This was chosen over owner-only so a non-technical member can curate their own view of the workspace. Attribution and feed entries make changes visible.
- **[Trade-off] The brief can be stale.** `HOME.md` is only as current as whoever last asked the agent to update it. The jobs list and widgets beneath it are live.

## Migration Plan

1. Additive Prisma migration (`DIRECT_URL`, as AGENTS.md notes):
   - new tables `WorkspaceEvent` and `WorkspaceWidget`
   - nullable columns `WorkspaceMember.lastSeenAt` and `Chat.sharedToWorkspaceAt`
   - no backfill is required for correctness
2. Optional one-off script: seed `WorkspaceEvent` from existing `ScheduledJobRun` rows (completed/error) and `WorkspaceMember.joinedAt`, so a new feed is not empty. It is idempotent on `(kind, runId)`.
3. Deploy. No new environment variables. The sandbox image is unchanged.
4. Rollback: revert the app. The new tables and columns are ignored by the old code and can be dropped later.

## Open Questions

- Event retention: keep everything, or prune run events older than 90 days? This can be set after observing volume.
- Whether a weekly digest notification (counts only, no model) should come in this change or with the AI catch-up follow-up. It does not affect the schema.
