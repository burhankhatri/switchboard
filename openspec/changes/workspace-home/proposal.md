## Why

A workspace is shared, but most of what happens in it is not. Chats and scheduled jobs are listed per user (`GET /api/chats` and `GET /api/scheduled-jobs` both filter on `userId`), so when one member sets up campaigns and lead generation, a second member opens the workspace and sees an empty chat list, no jobs, and ten bare run statuses. Even what is visible is written for the person who built it: a cron prompt, a `SKILL.md` and a run status do not tell a non-technical colleague what the workspace does or whether it is working. The promise in WORKSPACES.md — "the colleague opens it and it works" — currently stops at "it runs"; it does not extend to "they understand what it is doing".

## What Changes

- **Workspace home.** Opening a workspace with no chat open shows a home page for every member: a plain-language brief, what is running, pinned widgets, and recent activity. It replaces the current `HomeView` body (new-chat button, connections, own recent chats).
- **The brief is `HOME.md`.** A Markdown file in the workspace folder, rendered at the top of home. It is committed like any other file, so the agent can write it ("update the workspace brief with what we just built") and members can edit it. A missing file shows a prompt to have the agent draft one.
- **Scheduled jobs are visible to every member.** Home lists all of the workspace's approved jobs, whoever created them, with schedule in words, author, last run and health. Editing, deleting and running a job stay with its author; this change grants visibility, not control.
- **Workspace activity feed.** One timeline per workspace: jobs created/approved/failing, runs finished, files committed, widgets pinned, members joined, chats shared. Backed by a new append-only `WorkspaceEvent` table written at the points those things already happen.
- **Chats stay private, with opt-in sharing to the workspace.** A chat's owner can share it to the workspace; members can then read it (read-only) from home and the feed. Unsharing removes access.
- **Home widgets.** Cards of a fixed set of types — stat, table, chart, file, job, note — described by validated JSON, never HTML or script. Created three ways: by hand from home, by "Pin to Home" on a chat message or workspace file, or by the agent through new `pin_to_home` and `update_home_widget` tools on the existing run-scoped MCP endpoint. Agent-created widgets appear immediately; every widget shows who or which run last updated it, linking to that chat or run.
- **"Since you were last here."** Home records when each member last opened it and summarises the events since then as counts and highlights (runs, failures, new widgets, shared chats). Deterministic — no model call.

Not in this change: AI-written catch-up summaries and an emailed weekly digest (both need a server-side model call, and the deployment's only Anthropic credential is a personal subscription — see PROGRESS.md "Known risks"); widgets that query a connection live (needs the credential broker); free-form HTML widgets; a builder/operator view mode.

## Capabilities

### New Capabilities
- `workspace-home`: the home page of an open workspace — the `HOME.md` brief, the workspace jobs list, the activity feed, home widgets (types, creation, provenance, agent tools), and the since-last-visit summary.

### Modified Capabilities
- `agent-runs`: the run-scoped MCP endpoint gains widget tools, and scheduled runs must receive that endpoint so a job can refresh its widgets.
- `workspace-management`: workspace contents now include jobs, shared chats, events and widgets, all member-only; chat sharing to a workspace is defined here.

## Impact

- **Schema (additive migration):** `WorkspaceEvent`, `WorkspaceWidget`, `WorkspaceMember.lastSeenAt`, `Chat.sharedToWorkspaceAt`.
- **APIs:** new `GET /api/workspaces/:id/home` (one gated request, same pattern as `/overview`), `GET /api/workspaces/:id/events`, widget CRUD under `/api/workspaces/:id/widgets`, `POST/DELETE /api/chats/:chatId/workspace-share`; `GET /api/chats/:chatId` read path admits members for shared chats.
- **MCP:** `app/api/mcp/scheduler` (and `lib/mcp/scheduler-server`) gains two tools; the scheduled-run path must pass the server and a run token.
- **UI:** `components/chat/HomeView.tsx` rebuilt from new `components/workspaces/home/*`; "Pin to Home" on assistant messages and in the file context menu; "Share to workspace" in the chat menu. Charts use the already-installed `recharts`; widget validation uses `zod`.
- **No new dependencies, no environment changes, no sandbox image rebuild.**
