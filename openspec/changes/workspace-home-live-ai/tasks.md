## 1. Workspace context and persistence

- [x] 1.1 Reconcile the predecessor home spec's summary navigation, refresh and derived-content privacy scenarios with this approved plan.
- [x] 1.2 Add additive persistence for home operations/events, suggestions, insights and context versions.
- [x] 1.3 Implement bounded retrieval and incremental digests of all users' chats in the selected workspace, with evidence references and existing-widget context.
- [x] 1.4 Enforce membership at submission and execution, preserve raw transcript permissions, and add member-facing derived-content policy copy.

## 2. Home AI execution and live updates

- [x] 2.1 Trace agent start, completion and reconnect paths and implement durable home-scoped execution with context reads and widget mutations.
- [x] 2.2 Add start/status/event/cancel APIs with persisted stages, error and partial-completion states.
- [x] 2.3 Reuse widget validation and attribution; add target-version checks and idempotency to prevent stale overwrites and duplicate writes.
- [x] 2.4 Connect resumable progress events and polling fallback to home caches so each saved component appears live for viewers.

## 3. Inline prompts and pencil editing

- [x] 3.1 Build a reusable accessible prompt popover with editable scenario defaults and send/cancel/error states.
- [x] 3.2 Replace home Ask agent navigation, including summary and chart creation, with inline operations.
- [x] 3.3 Add visible pencil actions for all widget types and chat-derived home content, targeting the selected component and preserving manual editing.

## 4. Suggestions

- [x] 4.1 Add an always-available Suggestions entry point and an inviting empty-home state.
- [x] 4.2 Generate source-backed create/update previews using current widgets; avoid duplicates and respect widget capacity.
- [x] 4.3 Implement accept, dismiss and refresh actions with stale-preview checks; accepted suggestions create or update components live.

## 5. Proactive findings

- [x] 5.1 Enqueue debounced, durable insight refresh after relevant conversation turns with bounded cost and loop prevention.
- [x] 5.2 Correlate issues, blockers and decisions across users; retain attribution, evidence and supported resolution status.
- [x] 5.3 Display automatically refreshed insight cards and merge duplicate findings; keep proposed authored-widget changes behind acceptance.

## 6. Timeline and loading design

- [x] 6.1 Replace text-heavy timeline rows with visual milestones, icons, status pills, date grouping and expandable detail.
- [x] 6.2 Add stable initial skeletons and active creation/editing treatments with actual stage labels and incremental reveal.
- [x] 6.3 Verify mobile layout, keyboard interaction, screen-reader progress announcements and reduced-motion behavior.

## 7. Verification and documentation

- [x] 7.1 Test context isolation, revoked membership, transcript-link visibility, schema rejection, stale edits, retries and repeated acceptance.
- [x] 7.2 Test empty/populated suggestions, duplicate findings, later issue resolution, partial failure, cancellation and reconnect recovery.
- [x] 7.3 Browser-verify summary creation, pencil edits, accepted suggestions, proactive findings and live updates with two viewers, including mobile.
- [x] 7.4 Run web TypeScript checks with zero errors and the required repository tests; record live infrastructure checks separately.
- [x] 7.5 Update PROGRESS.md and migration/rollout notes, validate OpenSpec, and report any unverified behavior.

## Verification record

- Web typecheck: zero errors.
- Full suite: 851 web tests and 18 sandbox-image tests pass. On Windows, Git Bash must precede the Windows/WSL bash shim on PATH.
- Browser: production home components against a deterministic HTTP fixture, including summary creation, prompt rewriting, pencil edits, finding edits, accepted update suggestions, two viewers, mobile and reduced motion; zero browser errors.
- Database: scratch localhost database, all 45 migrations applied; actual transaction checks cover context isolation, multiple users, concurrency, duplicate execution, stale edits, partial writes, cancellation, insight deduplication/resolution and source-link access. The scratch database is removed by the check.
- Live Daytona/model execution and production deployment remain rollout checks; they are not claimed by the browser fixture or database check. The implementation uses existing workspace agent credentials, as requested.
