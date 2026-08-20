# Notifications — workspace membership and agents waiting on you

## The problem

Two things happen that nobody finds out about.

**You get added to a workspace and are never told.** `POST /api/workspaces/[id]/members`
makes you a member immediately. There is no signal — you discover it by noticing a
new entry in the workspace picker. It is written to `ActivityLog`, but that is an
audit table, not an inbox.

**An agent asks you a question and the turn just ends.** `lib/session.ts:122-125`
instructs every agent: *never use AskUserQuestion; write a numbered list of
questions; then finish your turn.* So a blocked turn and a completed turn are
byte-for-byte identical in the database — same `Chat.status`, same message shape.
The question is prose. Nothing marks it, so nothing can surface it.

The sharpest case is **scheduled jobs**: a `ScheduledJob` fires on the cron with
nobody watching. If that agent asks something, the run reports success, the
question sits in a chat nobody opens, and with `continueFromLastRun` the next run
carries on regardless.

## Decisions taken

- **Membership stays immediate.** Adding someone keeps working exactly as today;
  they simply get told. A pending-accept gate would contradict the product thesis —
  add a person and it works. A real `Invite` model is deferred, not rejected.
- **A structured marker, not question-detection.** The agent marks a blocked turn
  explicitly. Heuristics would fire on "Want me to keep going?" after finished work.
- **In-app bell + badge, plus Web Push.** No email; there is no sender wired up.

## The constraint that shapes everything

**A polled badge would undo the cron fix.** Neon suspends a compute after five
minutes without a query. `agent-lifecycle` running every 60s is what kept the
database awake around the clock and produced the ~$18 bill; it is now `*/30`.

A notification count polled every 30 seconds re-creates that bill exactly, and it
would look like a feature rather than a regression.

So:

- **Nothing polls on a timer while the tab is hidden or unfocused.** The badge
  query uses `refetchOnWindowFocus` and a visibility gate, never a bare interval.
- **Piggyback before adding endpoints.** `useChatsQuery` already runs; return the
  unread count on a response the client is fetching anyway rather than opening a
  second request path.
- **Web Push carries the away case.** Push is server-initiated and costs nothing
  when idle — it is the correct answer for "nobody is looking", not a faster poll.

`lib/cron-schedule.test.ts` already fails any cron under 10 minutes. This plan adds
the equivalent guard for client intervals.

---

## Phase 1 — the record

**1.1 `Notification` model** (`prisma/schema.prisma`)

```
id, userId, kind, title, body, chatId?, workspaceId?, readAt?, createdAt
kind: "workspace_member_added" | "agent_needs_input"
@@index([userId, readAt, createdAt])
```

`onDelete: Cascade` from User; `SetNull` from Chat/Workspace so deleting a chat
does not erase the record that you were asked something.

**1.2 A single writer** (`lib/db/notifications.ts`) — `notify({userId, kind, …})`,
plus `unreadCount(userId)`. Deliberately one function so Phase 4 can hang push
delivery off it without every caller learning about push.

**Never notify the actor.** Adding yourself, or answering your own agent, must not
produce a notification. This is the first test.

## Phase 2 — the agent marks a blocked turn

**2.1 Extend the existing convention** (`lib/session.ts`). The prompt already says
to ask inline and end the turn; it gains one line — end a blocked reply with a
sentinel on its own line.

**2.2 Parse and strip at persist time** (`app/api/agent/stream/_lib/persist-snapshot.ts`,
`app/api/chats/[chatId]/messages/_lib/persist-turn.ts`). Set `Chat.awaitingInput`,
write the notification, and **remove the sentinel from the stored content**.

> **The main risk in this plan.** If stripping ever misses, users read raw
> `<needs-input />` in the transcript. It must be stripped on every persist path —
> there are two — and the share path (`lib/server/shared-chat.ts`) as well. Tested
> per path, not once.

**2.3 Clear on reply.** The next user message in that chat sets `awaitingInput`
false. A chat cannot be waiting on you after you have answered.

**2.4 Scheduled jobs.** `_lib/scheduled.ts` — a blocked run is not a success.
Surface it distinctly from `completed` and `error`, and do not let
`continueFromLastRun` silently carry on from an unanswered question.

## Phase 3 — membership

`POST /api/workspaces/[id]/members` calls `notify()` alongside the existing
`logActivityAsync`. Body names the actor and the workspace, links to it. Removal
notifies too — losing access silently is worse than gaining it silently.

## Phase 4 — the bell

**4.1 `GET /api/notifications`** (list + unread count), **`POST /api/notifications/read`**.

**4.2 `useNotificationsQuery`** — a pure `notificationsPollInterval({visible, focused})`
extracted and unit-tested the way `serversPollInterval` was, so the interval logic
is assertable without a browser and cannot silently regress to a bare number.

**4.3 `NotificationBell`** in the header: badge, dropdown, click-through to the
chat or workspace, mark-read on open.

**4.4 A chat waiting on you is marked in the sidebar.** The bell is for arrival;
the sidebar is where you look when deciding what to work on.

## Phase 5 — Web Push

Nothing exists yet: no service worker, no manifest, no VAPID keys.

**5.1** `PushSubscription` model (endpoint, p256dh, auth, userId).
**5.2** `public/sw.js` + registration, VAPID keys via env, permission requested
from an explicit control — never on page load.
**5.3** `web-push` send inside `notify()`, so Phases 2–3 gain push for free.
**5.4** Prune subscriptions on a 410 from the push service, or the table grows
forever with dead endpoints.

---

## Verification

- `npx tsc --noEmit` → 0; `npx vitest run` → 269 existing tests still green.
- **Cost guard:** a test asserting no notification query uses an unconditional
  interval, mirroring `cron-schedule.test.ts`. The failure mode is silent —
  nothing breaks, the bill arrives.
- **Sentinel leak:** assert the marker never survives into stored content, on
  both persist paths and the share path.
- **Actor exclusion:** adding yourself, and answering your own agent, produce
  nothing.
- Drive it in the browser: two accounts, add one to a workspace, confirm the bell.
  Ask a question from an agent, confirm the chat is marked and clears on reply.

## Not in this plan

- **True pending invites.** Deferred by choice; membership stays immediate.
- **Email.** No sender is configured, and push covers the away case.
- **Read receipts / per-device sync of read state.** `readAt` is per user.
