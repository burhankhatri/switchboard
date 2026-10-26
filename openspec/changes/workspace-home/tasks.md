## 1. Schema

- [x] 1.1 Additive migration: `WorkspaceEvent` (indexed `(workspaceId, createdAt)`), `WorkspaceWidget` (with optional unique `(workspaceId, key)`), `WorkspaceMember.lastSeenAt`, `Chat.sharedToWorkspaceAt`; run with `DIRECT_URL`, regenerate the client.

## 2. Events

- [x] 2.1 `recordWorkspaceEvent()` in `lib/workspace-home/events.ts`: fire-and-forget, never throws, freezes a display `summary`; unit tests for the no-throw contract.
- [x] 2.2 Record job create / approve / enable-disable / delete in `api/scheduled-jobs` routes.
- [x] 2.3 Record run completed / failed in `cron/agent-lifecycle/_lib/scheduled.ts`.
- [x] 2.4 Record file commits (files, import, edit-text, delete routes, and run auto-push) as one event per commit with a file count.
- [x] 2.5 Record member join / leave / add / remove.
- [x] 2.6 `GET /api/workspaces/:id/events?before=` — gated, paginated, resolves chat links only for chats currently shared; tests for non-member 403 and hidden private-chat links.

## 3. Home data

- [x] 3.1 `GET /api/workspaces/:id/home` — one `gateWorkspace`, concurrent reads of jobs (approved and awaiting approval, each with author and last run), widgets, first event page, shared chats; route tests.
- [x] 3.2 Job health (healthy / failing with count / paused) and schedule-in-words, reusing `describeInterval`; unit tests.
- [x] 3.3 Since-last-visit: read `lastSeenAt` (default now − 7 days), compute counts and up to five highlights (failures first), then update `lastSeenAt` debounced at 5 minutes; unit tests for first visit, nothing new, and the debounce.

## 4. Home page UI (phase 1)

- [x] 4.1 Split `HomeView` into `components/workspaces/home/*` without behaviour change (refactor commit).
- [x] 4.2 Brief section: render `HOME.md` via the existing file read and Markdown preview, Edit opens it in the file editor; missing file shows "Have the agent draft it", which starts a chat with a preset prompt.
- [x] 4.3 Jobs section: cards with health, schedule, author, last run; "Awaiting approval" group; non-authors see no edit/delete/run controls; links to runs and their chats.
- [x] 4.4 Activity feed with "Load older".
- [x] 4.5 Since-last-visit banner, hidden when empty.
- [ ] 4.6 Update `docs`/PROGRESS and the `app-navigation` home-page wording if it no longer matches.

## 5. Sharing chats to the workspace

- [x] 5.1 `POST`/`DELETE /api/chats/:chatId/workspace-share` — owner only, chat must have a workspace; records the share event.
- [x] 5.2 Read-only `GET /api/workspaces/:id/chats/:chatId` for current members: shared chats and scheduled-run chats in that workspace, sanitized like a public link, 404 otherwise; owner chat routes untouched; tests for non-member, scoping, sanitising (unshare and removed-member follow from the per-request check)
- [x] 5.3 "Share to workspace" toggle in the chat menu; read-only rendering for non-owners reusing the `/share/[shareId]` components; "Shared chats" list on home.

## 6. Widgets (phase 2)

- [x] 6.1 `lib/workspace-home/widgets.ts`: zod schemas for stat, table (≤50 rows), chart (line/bar, ≤6 series, ≤500 points), file, job, note; 64 KB and 40-per-workspace limits; http(s)-only link check; unit tests for each type and each limit.
- [x] 6.2 Widget CRUD + reorder under `/api/workspaces/:id/widgets` — member-gated, shared validator, provenance fields set on every write, events for person-made create/update/delete; route tests.
- [ ] 6.3 Widget renderers (recharts for charts, sanitised Markdown with raw HTML disabled for notes, existing previews for files, live status for jobs), missing-target and stale states, provenance line with links (chat link only when shared).
- [ ] 6.4 Add-widget menu on home (note, file, job) and drag reorder.
- [ ] 6.5 "Pin to Home" on assistant messages: client-side table/stat/note detection, editable preview before saving, stores source chat and message.
- [ ] 6.6 "Pin to Home" in the workspace file context menu.

## 7. Agent tools

- [x] 7.1 Extend `RunTokenClaims` with optional `jobId`/`jobRunId`; tests that old tokens still verify.
- [ ] 7.2 `pin_to_home` and `update_home_widget` (by id or `key`) on the MCP endpoint: shared validator, membership re-checked per call, cross-workspace ids treated as not found, provenance from claims; tool descriptions tell the agent to put the widget key in any job prompt that refreshes it; tests in `scheduler-server.test.ts`.
- [ ] 7.3 `tools/list` by claims: interactive runs get all three tools, scheduled runs get the widget tools only; test.
- [ ] 7.4 Attach `schedulerMcpServer({ …, jobId, jobRunId })` in `_lib/scheduled.ts`; test that a scheduled workspace run's `mcpServers` includes it and a run without a reachable origin proceeds without it.
- [ ] 7.5 Optional seed script for events from existing runs and memberships, idempotent on `(kind, runId)`.

## 8. Verification

- [ ] 8.1 `npx tsc --noEmit -p tsconfig.json` clean and `npm run test` green after each group.
- [ ] 8.2 Extend `scripts/e2e-workspace.mjs`: second member sees the first member's job, widgets and shared chat; cannot see an unshared chat; is refused after removal.
- [ ] 8.3 Real run: in a workspace with a tunnel origin, ask the agent to pin a chart, then run a job whose prompt refreshes it, and confirm the provenance names the job.
- [ ] 8.4 Sync specs into `openspec/specs/` (new `workspace-home`, deltas to `agent-runs` and `workspace-management`) and update PROGRESS.md.
