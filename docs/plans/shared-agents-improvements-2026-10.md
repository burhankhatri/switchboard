# Plan — make the Switchboard agents considerably better (2026-10-28)

Scope: the GTM Lead Engine and Pricing Bot workspaces as run through Switchboard
(`packages/web`, `packages/sdk`, the `burhankhatri/agent-workspaces` repo). This
began as an investigation and a plan; section 2b records what shipped. Every
number in sections 0 and 1 was measured on 2026-10-28 from the **production**
database (Supabase, the `DIRECT_URL` in Vercel's production env, read-only),
the `agent-workspaces` repo at `2585d59`, this repo at `a60c021`, and
Instantly's audit log (read-only). Nothing was sent, pushed, enriched or changed.

The first version of this plan was measured against the Neon database that
`packages/web/.env.local` points at. That is a copy taken around 2026-10-05
plus one local-dev chat: 38 chats and 150 messages against production's 53 and
423. Every section-0 and section-1 number below was recomputed from production
with the same metric definitions (the script reproduces the published Neon
figures exactly when run on the Neon export). Where a conclusion changed, it
says so.

## 0. The question, and the verdict

Burhan's hypothesis: *shared-agents is defaulted at GLM, and the way it accesses
data is not optimised; the agents need to be considerably better.*

**Verdict (is-it-bs): right on both counts, and more so than the first,
stale measurement said.** Long jobs killing turns, not blank replies, is what
hurt users most.

| Claim | Finding (production) |
|---|---|
| "Defaulted at GLM" | **True, and it is most of what users saw.** `DEFAULT_HARNESS` is OpenCode on `opencode-go/glm-5.2` (`packages/web/lib/default-harness.ts:8`). GLM-5.2 ran **181 of 224** assistant turns (81%) and 2,426 of 2,722 tool calls. Free models ran 32 turns, Claude 6. *(The Neon copy said 34 of 77 and made the free models look like the main problem; they were not.)* |
| "Data access is not optimised" | **True, and first-order.** A tool-using turn makes 18 tool calls on average (median 13, max 71); 20% of commands repeat inside the same turn. Across chats the Instantly campaign list was fetched 120 times and the lead store read 159 times. GLM-5.2 read 108.2M cached tokens against 6.0M fresh input (18:1): the prompt and skills are re-read on every step. Spend was **$47.50**, $46.40 of it GLM-5.2. *(The Neon copy said $5.69 and called this second-order.)* |
| "The agents are poor" | **Mixed, with one dominant failure.** **17 turns were killed at the 25-minute limit**, 15 of them Wayne's and 16 of them sleeping or polling a job. Seven replies were blank. 114 tool outputs show an environment failure, 69 of them the pricing bot's Chrome driver. On the other side: every push was asked for in the turn, GLM-5.2's failed-call rate (8.1%) is well under big-pickle's (13.8%), and agents found and fixed real bugs in their own scripts. |
| "A teammate's Switchboard agent enrolled 1,016 contacts" | **Supported.** Wayne's GLM-5.2 chat `cmuwx5cs` ran `push_to_instantly.py --apply` into campaign `9e8897c8` five times with results that match Instantly's audit log one for one (42, 61, 401, 173, 323). Wayne asked for each push in that turn. The script then called Instantly's `/leads/add` directly, so no address was verified, no CRM record was written and no lead was stamped `pushed`. *(The Neon copy had none of these chats, and the first version of this plan said the enrolment happened outside Switchboard. That was wrong.)* |

Judgment on the ask: **JUSTIFIED** for a plan. The model question moves from
SIMPLIFY to **EXPERIMENT**: GLM-5.2 is the agent users actually experienced, so
a bounded Claude trial on long and write turns (2.9) is worth running, judged on
the criterion there.

## 1. What was measured

### Corpus (production, 2026-08-18 to 2026-10-28)

| | |
|---|---|
| Chats | 53 (gtm-lead-engine 28, pricing-bot 12, marketing-automation 6, none 5, smartclusive 2); 10 have no messages |
| Users | Burhan 39 chats, Wayne 11, Abdul Rehman 2, stclair-github 1. Wayne's chats hold 136 of the 224 assistant turns (61%), 77 of them in pricing-bot |
| Messages | 423 (199 user, 224 assistant); 151 assistant turns used tools |
| Tool calls | 2,722: Bash 1,793, Read 344, Edit 227, skill 122, Grep 86, Write 73, Glob 30, other 47 |
| Per tool-using turn | mean 18.0, median 13, max 71 |
| Failed tool calls | 235 (8.6%) |
| Repeated commands inside one turn | 555 (20.4%) |
| Scheduled jobs / runs | 1 / 0 (11 jobs were proposed through the scheduler tool; 1 remains) |
| Spend (TokenUsage ledger) | $47.50: GLM-5.2 $46.40 (214 rows, 6.0M in, 1.04M out, 108.2M cache reads), Opus 4.8 $0.75, GLM-5.1 $0.32, Haiku $0.02, big-pickle and Nemotron $0 |
| Cost per metered turn | median $0.074, mean $0.21, max $1.55 |
| Heaviest user-days | Wayne 10-12 $8.45, 10-06 $5.70, 10-08 $5.32, 10-09 $4.90; Burhan 10-01 $3.66. 14 of 25 user-days with spend exceeded $0.50 |
| Turn time (ledger timestamp minus the prompt, 136 metered turns) | median 91 s, 90th percentile 11.6 min, max 27 min; 18 turns over 10 min, 9 over 20 min |

All four users are on the `unlimited` plan, so no shared-pool budget applies to
anyone today. The $0.50 cap tripped once (Burhan, 2026-10-01, at $0.58), before
that changed.

### By model

| Model | Turns | Tool calls | Failed calls | Repeats | Blank replies |
|---|---|---|---|---|---|
| opencode-go/glm-5.2 | 181 | 2,426 | 196 (8.1%) | 472 | 3 |
| opencode/big-pickle (free) | 28 | 261 | 36 (13.8%) | 82 | 4 |
| claude-code (default/haiku) | 6 | 10 | 2 | 0 | 0 |
| opencode-go/glm-5.1 | 5 | 25 | 1 (4%) | 1 | 0 |
| nemotron-3-ultra-free | 4 | 0 | 0 | 0 | 0 |

The three Opus turns in the first version (a 2026-10-26 home-page session) were
a local-dev chat that exists only in the Neon copy.

### Where users were failed

- **Turns killed at 25 minutes: 17.** Fifteen were Wayne's. Nine were in
  pricing-bot: pricing runs over 267 and 102 opportunities, a daily
  spreadsheet update, a merge conflict. Seven were the 10-12 to 10-15
  enrichment push ("please enrich the leads and get them put into instantly",
  "keep adding leads until the qualified lead count is around 1100"), and one
  was Burhan's 10-01 "do it". In 16 of the 17 the agent was sleeping or polling
  a job inside the turn. Each ended with "Agent stopped: Run exceeded 25 minute
  limit" and a person typing "please continue".
- **Blank replies: 7**, all with `isError = false`. Wayne's first three
  pricing-bot messages (09-22, 09-24 twice) hit "OpenCode 1.18.0 or newer is
  required to use the free tier"; Burhan's "hi" the same day; and three on
  GLM-5.2 (Wayne, 10-06 and 10-12 twice). The activity log holds 10 provider
  errors in all.
- **"Did you do it?" questions: 5** (Burhan four times, 09-25 to 10-01; Wayne
  once, 10-14: "I still show just 119 leads in the campaign … have you
  enriched"). Three prompts were re-sent word for word.
- **Environment.** 114 tool outputs show an environment failure: the pricing
  bot's Chrome driver 69 (it downloads a driver with `ChromeDriverManager` and
  calls `win32process`), `/tmp/opencode` permission denied 25, a missing Python
  module 10 (2 of them `requests`), a network reset or timeout 5, `jq` 3,
  `python` 2.
- **Re-reading.** 122 skill-tool loads and 55 raw `Read SKILL.md` calls in 151
  tool-using turns (up to 10 in one turn); the campaign list fetched 120 times
  in 46 turns (up to 7 in one); the lead store read 159 times in 46 turns (up
  to 10 in one); 55 job polls in 16 turns.
- **The 1,016-contact enrolment** (all in Wayne's chat `cmuwx5cs`, GLM-5.2):

  | When (UTC) | Asked | Instantly accepted |
  |---|---|---|
  | 10-06 18:03 | "Please build an identical campaign … name it Lead Engine campaign. Once it is built, please add …" | 42 (`--include-pushed`) |
  | 10-12 17:37 | "can you move the rest of the enriched leads into instantly campaign Lead Engine campaign?" | 61 |
  | 10-14 20:55 | "I want the leads to go into the Lead Engine campaign not the already running Verified Bill campaign." | 401 |
  | 10-15 15:38 | "keep adding leads until the qualified lead count is around 1100" | 173 |
  | 10-15 17:16 | "The lead engine shows that it has 1147 enriched leads. Instantly … only shows 693. Please …" | 323 (`--limit 2000`) |

  Two further runs on 10-15 uploaded nothing. The same chat activated campaign
  `da6bed9e` on 10-06 and ran four paid `/api/run` driver scripts on 10-14 and
  10-15, each on request. The rule "only when the user asks in that turn" was
  followed every time; the damage came from the path the script took.
- **Privacy.** 16 GLM-5.2 replies name 18 third-party email addresses, 10 of
  them in pricing-bot reports of who a proposal went to; none prints more than
  three. The first version credited GLM-5.2 with keeping names out of chat;
  that holds for lead lists, not for proposal reports.
- **Stale and divergent skills; guardrail drift.** Unchanged from the first
  version (repository facts, not database facts): the workspace
  `lead-engine-api` skill differed from the engine's by 688 diff lines and told
  agents to push around the engine; `pricing-bot-guide` was a placeholder; the
  "asked in that turn" rule was prose in five skills and drifted once
  (LEARNINGS 29).

### What worked

- Every write in the record was asked for in the turn it happened, and the
  dry-run-first scripts showed a preview first.
- The agents found real bugs in their own tools (unsorted paging returned 518
  rows with 305 unique leads; Cloudflare 403 on Python's User-Agent; the
  `campaign_id` filter that Instantly silently ignores) and fixed them.
- The scheduler tool was used as intended: Wayne's agents proposed 11 jobs for
  daily spreadsheet updates, each waiting for approval.
- On 10-27 a GLM-5.2 turn built the gtm-lead-engine home page from live reads
  (6 widgets pinned, 2 updated), nothing written outside Switchboard.

## 2. The changes, ranked by impact

Each item: what it changes, what it costs, what it is expected to change, and
how to tell. Nothing here needs a new service.

### 2.1 Never return an empty turn (highest impact, lowest cost)

**Problem.** A provider error produces an assistant message with empty
content and `isError = false`: seven in production, three of them Wayne's first
pricing-bot messages on the free tier and three on GLM-5.2. PROGRESS.md "Next" item 4 ("fail loud on
bootstrap") is the same gap.

**Change.** In the turn persister (`messages/_lib/persist-turn.ts`) and the
stream route: when a turn ends with no text and no tool calls, or an
`llm_provider_error` was logged for it, write a visible message that names the
error and the fix ("the free model needs OpenCode ≥ 1.18; switch the model
here") and set `isError = true`. Pin the OpenCode binary in the sandbox image
so the free-tier version error cannot recur.

**Cost.** Small: one branch in persist-turn, one test, a version pin in
`packages/sandbox-image/src/image.ts`.

**Expected effect.** Zero blank assistant messages; users stop re-sending
prompts.

**Verify.** Unit test: a provider-error event yields a non-empty error message.
Query: `select count(*) from "Message" where role='assistant' and content=''
and "toolCalls" is null` trends to zero on new chats.

### 2.2 Make writes visible and receipted

**Problem.** Users asked four times whether an action had happened; once the
agent had acted on an ambiguous ask. Writes are curl `-X POST` or
`--apply` flags buried in Bash tool calls.

**Change.**
1. Classify tool calls at parse time (`packages/web/lib/session.ts`
   `getToolDetail`): a Bash call whose command contains `-X POST|PATCH|DELETE`
   against `$INSTANTLY_BASE_URL`/`$GTM_BASE_URL`, or `--apply`, or `/api/enrich`,
   `/api/run`, is tagged `write: true`. Render a "Writes this turn" line under the
   message: endpoint, count if the response carried one, and the response code.
2. Append the same list to the `WorkspaceEvent` feed (already exists for
   commits and widgets), so a teammate opening the workspace sees "16 leads
   added to draft 7c08d5fb by Burhan's agent".

**Cost.** Medium-small: a regex classifier with tests, one UI line, one event
type.

**Expected effect.** "Did you…" questions disappear; every external write is
auditable from Switchboard, not only from Instantly's audit log.

**Verify.** Replay the stored messages through the classifier: it must tag
every push, draft creation, activation and paid run, and nothing in the
read-only chats.

**Result on production (2026-10-28, after shipping).** 40 calls tagged in 25
turns across 9 of the 32 chats that used tools. About 36 are real writes. It
**misses** about 8: three campaign activate or pause calls made through the
`_http.request("POST", f"{base}/campaigns/{cid}/activate")` helper (the path
pattern rejects a second `{…}`), one `urllib.request.Request(…/api/enrich,
method="POST")`, and four runs of driver scripts the agent first wrote to
`/tmp/logs/*.py`. It **mislabels** commands that chain several curl calls,
taking the verb from one and the URL from another (a `/leads/list` read shown
as a write to `/campaigns`). Fixes are listed in 2b.

### 2.3 One source of truth for the Lead Engine skill, and close the bypass

**Problem.** Two divergent skills; the workspace one codifies the direct
`POST /leads/add` path that the engine's gotchas now forbid; `chain=false` is
missing from the push script; store counts in prose go stale in days.

**Change.**
1. Publish `lead-engine-api/SKILL.md` from the `gtm-lead-engine` repo into the
   workspace folder by a small sync script (or a CI step in `gtm-lead-engine`
   that opens a PR on `agent-workspaces`). The workspace copy becomes
   read-only.
2. Rewrite `lead-to-campaign` and `push_to_instantly.py` so enrolment goes
   through `POST /api/leads/push` now that the engine's push verifies emails,
   writes the CRM record and stamps `pushed`. Keep the script's preview
   (municipal cities, unlikely signers, wrong-domain contacts) as the dry run,
   and add `chain=false` to its server-side filter. Remove the direct
   `/leads/add` call.
3. Replace every "store today" table in the skills with the one command that
   fetches it (`GET /api/stats`, `instantly_report.py`), and date-stamp what
   stays.
4. Fill `pricing-bot-guide/SKILL.md` from what the 09-22 and 09-25 chats
   established (what runs on Linux, what needs the matrix files, that the
   credentials are hardcoded and must move to a connection).

**Cost.** Medium: a day of skill editing plus the push rewrite with its tests
(`tests/test_push_to_instantly.py` exists, 105 tests). The engine side is
already live.

**Expected effect.** No contact reaches Instantly without the engine's
verification and `pushed` stamp; agents stop quoting September counts.

**Verify.** `diff` of the two skill copies is empty after sync; a dry run on
the shared sandbox shows `chain` drops; `grep -c "leads/add"
scripts/push_to_instantly.py` is 0; the skill harness (`npm run test:skills`)
still passes.

### 2.4 Long jobs: wait outside the turn

**Problem.** 17 turns were killed at the 25-minute limit, 15 of them
Wayne's, and in 16 the agent was sleeping or polling inside the turn. Seven were
enrichment and paid-run loops in gtm-lead-engine; nine were pricing-bot runs
over hundreds of opportunities, which `wait_job.py` does not cover because they
are local Selenium loops, not engine jobs.

**Change.** Two options, pick one:
- **Small:** a `scripts/wait_job.py <job_id> --max-minutes 12` helper that
  sleeps server-side with backoff and prints one summary line, plus a skill
  rule: "an enrich or run job is started, then the turn ends with the job id and
  the marker; the next turn reads it". The turn no longer blocks.
- **Better:** an MCP tool on the run-scoped endpoint (`lib/mcp/scheduler-server.ts`
  already hosts `pin_to_home`): `watch_job(url)` that stores the job and wakes
  the chat when `done: true`, the way `ScheduledJobRun` already re-enters a chat.

**Cost.** Small for the script; medium for the MCP tool (a poller in the
agent-lifecycle cron, which already runs every 30 min and must not run faster:
Neon idle cost).

**Expected effect.** No turn killed by the hard timeout for a reason that is
waiting; enrichment of 100 buildings fits in one request.

**Verify.** Re-run the 10-01 "do it" scenario against a test ZIP with `cap` 1:
the turn ends under 2 minutes and the follow-up turn reports the result. In
production, "Run exceeded 25 minute limit" messages per week fall from the
October rate (17 in 26 days). The pricing-bot runs need the same treatment:
batch the run and end the turn, or run it as a scheduled job.

### 2.5 Budgets and timeouts set from the ledger, not placeholders

**Problem.** `usage-budgets.ts:38` capped the shared OpenCode pool at
$0.50/day per user as a placeholder; it tripped on the one day it applied. The
25-minute interactive limit is right for a runaway, wrong for a sanctioned
enrichment.

**Corrected by the production recompute.** The heaviest real day was $8.45
(Wayne, 10-12), not about $2.50, and three user-days exceeded $5, so the $5
figure shipped in 2b was set from the stale data. It binds nobody today because
all four users are on the `unlimited` plan, but it is wrong for any future free
user. A second problem: metering backdates a session's first ledger rows to
1970 whenever the chat already has turns (`lib/server/token-metering.ts:164`),
to avoid charging pre-metering backlog. In production that fired for **61
separate sessions in 13 chats**, including fresh sessions started mid-chat,
which hides **$23.46 of the $47.50** from every daily budget window.

**Change.** Set the OpenCode budget from the ledger: about $10/day (just
above the heaviest real day, $8.45), with a warning at 80% shown in the
composer. Backdate only a session that existed before metering, not every
session that is new to the ledger. Show the remaining budget and the
turn's running time in the UI. Keep the 25-minute limit but make the warning
appear in chat at 20 minutes so the agent can wrap up.

**Cost.** Small: constants plus one UI indicator.

**Expected effect.** No cap trips during approved work; agents stop mid-task
on purpose rather than by kill.

**Verify.** `daily_limit_reached` rows in `ActivityLog` stay at zero over a
month of normal use; no `TokenUsage` row created after the fix is dated 1970.

### 2.6 Carry work between chats

**Problem.** Each chat starts from `main`; agent commits sit on `agent/*`
branches until a human merges. Specs and learnings written in one chat are
invisible in the next.

**Change.** Auto-merge agent commits that touch only documentation paths
(`campaigns/**`, `LEARNINGS.md`, `HOME.md`, `.claude/skills/**/reference/**`)
when the push succeeds and the diff has no deletions outside those paths.
Everything else keeps the review step. The `/merge` command and the
WorkspaceEvent feed already exist; this is a policy on top of `lib/push.ts`.

**Cost.** Medium-small: a path allowlist and a test; the risk is a bad doc
landing on main, which the feed makes visible and `git revert` undoes.

**Expected effect.** The next chat sees the last chat's spec and learnings;
no more "please merge it to main".

**Verify.** Create a spec in chat A, start chat B, `ls campaigns/` shows it
without a manual merge.

### 2.7 Shrink what every turn re-reads

**Problem.** 387 KB of skills and references, 11 descriptions of 637-1,135
characters (about 9.5 KB of catalog in every prompt), a 4.3 KB workspace
prompt, and for OpenCode the whole system prompt is prepended to the user
message every turn (`packages/sdk/src/background/session.ts:135-137`). The
first turn of the 09-25 campaign chat loaded seven skills and three reference
files, about 130 KB, before its first data call. In production GLM-5.2 read 108.2M cached
tokens against 6.0M fresh input tokens (18:1) for $46.40; that ratio is this
pattern.

**Change.**
1. Cut each SKILL.md to the rules and the commands; move tables, histories and
   "what has gone wrong" into `reference/` files the agent opens on demand.
   Target: no SKILL.md over 8 KB (today the four largest are 22-26 KB).
2. Descriptions under 300 characters; the triggers list moves into the body.
3. Give the scripts a compact summary mode (`instantly_report.py --brief`,
   `push_to_instantly.py --counts`) and have the skills prefer it, so an answer
   to "how many can we email" is one call and one screen, not a 442 KB fetch
   parsed in Python heredocs (the lead store was read 159 times in production).

**Cost.** Medium: editing eleven skills, with the skill harness as the safety
net. No code in `packages/web` changes.

**Expected effect.** Fewer tool calls per answer (median 8 today) and faster
first useful output; cache reads fall. This is the "data access" part of the
hypothesis, and it is worth doing, but after 2.1 to 2.4.

**Verify.** Re-run the three canonical prompts ("how many leads can we email",
"how did the campaigns do", "what's waiting on a human") on the harness and
count tool calls and input tokens before and after; `wc -c` of the skills.

### 2.8 Fix the sandbox image

**Change.** In `packages/sandbox-image/src/image.ts`: `python` →
`python3` symlink, `jq`, `python3-requests`, create `/tmp/opencode` and
`/tmp/logs` owned by `daytona`, pin the OpenCode version, and document the
egress allowlist (Instantly worked from 09-15 onward, so it was fixed, but
nothing records where).

**Cost.** Small; needs one snapshot rebuild, which already runs the skill
harness before promoting.

**Expected effect.** The `/tmp/opencode` (25), `requests`, `jq` and `python`
failures stop. The largest environment failure, the pricing bot's Chrome driver
(69 tool outputs), is not an image problem: the image already ships
`/usr/bin/chromium` and `/usr/bin/chromedriver`, but `crm_pricing_bot.py`
downloads its own driver and imports `win32process`. That needs a change in the
script, which the pricing-bot guide now describes.

**Verify.** `which python jq` and `python3 -c "import requests"` succeed in
`scripts/slice-zero.mjs`; `touch /tmp/opencode/x` succeeds.

### 2.9 Model choice per agent: keep GLM-5.2 for reads, test Claude on writes

**Evidence (production).** GLM-5.2 ran 81% of turns at a median $0.074 a
metered turn, with 8.1% failed tool calls against 13.8% on free big-pickle. So
the free models were worse per call, but most of what went wrong in absolute
terms happened on GLM-5.2: 196 of 235 failed calls, 15 of 17 timeouts, 3 blank
replies, 16 replies naming third-party addresses. Claude Code ran 6 turns, all
in August, mostly blocked by credentials (personal Max subscription,
PROGRESS.md "Known risks"), so there is no production evidence either way on
whether Claude would have changed an outcome.

**Change.**
1. Remove `requiresKey: "none"` models from the picker when the workspace has
   a shared key (`SHARED_OPENCODE_ALLOWED` already exists for Go models).
2. Keep `opencode-go/glm-5.2` as the workspace default.
3. Run a bounded experiment: for four weeks, campaign-builder and any turn that
   will call `--apply`, `/api/enrich` or `create_campaign.py --apply` runs on
   Claude (Sonnet 5.5 via the org key once PROGRESS.md's credential item is
   done). Success criterion, against the GLM-5.2 baseline above: fewer turns
   killed at 25 minutes per hundred long turns, fewer than one "did you…"
   question per ten write turns, failed calls under 8%, and no third-party
   address in a reply. If GLM matches it, stay on GLM.

**Cost.** Small for the picker change; the experiment needs the org-billed
Anthropic key, which is a prerequisite already listed in PROGRESS.md.

**Verify.** The per-model table in section 1 recomputed from the DB after the
four weeks, with the 2.2 write classifier supplying the write count.

### 2.10 Mechanical write gate (after 2.2 is in place)

**Problem.** The "only when asked in that turn" rule is prose in five places
and has already drifted (LEARNINGS 29).

**Change.** The scripts' `--apply`, `create_campaign.py --apply` and any
`/api/enrich` call require `SWITCHBOARD_APPROVAL=<id>`; the agent requests it
with a run-scoped MCP tool `request_approval(action, count, campaign)` that
sets `awaitingInput` and shows an Approve button next to the question. The
approval id is single-use and bound to the chat and the action string.

**Cost.** Medium: one MCP tool, one UI control, a check in three scripts.
Approvals are already a concept (`ScheduledJob.approvedAt`).

**Expected effect.** No write without a click; the rule leaves the prose and
stops drifting. It would **not** have prevented the 1,016-contact enrolment:
Wayne asked for every one of those pushes and would have clicked Approve. What
prevents a repeat is 2.3, which sends the push through the engine's
verification, CRM record and `pushed` stamp.

**Verify.** `push_to_instantly.py --apply` without the variable exits non-zero
in the test suite; a real run on the harness shows the Approve button and
proceeds only after the click.

## 2b. Status (2026-10-28, same day)

Shipped on `main` of this repo and of `agent-workspaces`:
2.1 (blank turns), 2.2 (write receipts and `external_write` feed events),
2.3 (push through `/api/leads/push` with `chain=false`, skill synced from the
engine repo by `scripts/sync_workspace_skill.py`, store tables replaced by
commands, pricing-bot guide), 2.4 small option (`wait_job.py` and the skill
rule), 2.5 ($5 budget, 80% composer line, 20-minute notice), 2.6 (doc-only
auto-merge), 2.7 partially (descriptions under 300 characters, `--counts`; the
SKILL.md bodies are still 11-26 KB and `instantly_report.py --brief` is not
done), 2.8 (image tooling; snapshot rebuild pending), 2.9 picker change (free
models hidden; the Claude experiment waits on the org key), 2.10 (approval gate
end to end). See PROGRESS.md for what was and was not verified. The snapshot
was rebuilt and promoted the same day after the skill harness passed.

**Defects the production recompute found, and their fixes (2026-10-28):**

1. **2.2 classifier — fixed.** Curl calls are judged one at a time; any helper
   called with a write verb and a path is tagged whatever its placeholders;
   urllib `Request`s with `data=` or a write `method=` and a literal path are
   tagged; a per-turn tracker tags running a script written earlier in the turn
   whose source makes writes; and an `updated: 2026-…` timestamp is no longer
   read as a count. Replayed over production: 45 writes tagged in 28 turns
   (was 40), now including the 10-06 activation of `da6bed9e`, the 10-15
   activation of `9e8897c8`, two urllib `/api/enrich` calls and five driver
   runs; the four chained-curl and probe mislabels are gone. **Still missed:**
   a script written in one turn and run in a later one (`enrich_run.py`, 10-14),
   because the tracker's memory is the turn.
2. **2.5 budget figure — fixed.** OpenCode is $10/day, just above the heaviest
   real day ($8.45).
3. **Metering backdating — fixed.** Backdating now requires the session to be
   the one the chat was already resuming. Of the 61 sessions backdated in
   production, 60 began after another session had been metered in the same
   chat, so the new rule would have charged them; the remaining one is a chat's
   first metered session. Rows already in the ledger are not rewritten.

**New finding from that check, root-caused (2026-10-28): agents forget the
conversation after 5 idle minutes.** Commit `0027bf0` (2026-09-22) made every
GitHub-backed chat's sandbox delete itself when it stops, and it stops after 5
idle minutes (`lib/sandbox.ts`, `autoStopInterval: 5`, `autoDeleteInterval: 0`),
to stay under Daytona's six-sandbox cap. The commit treated the sandbox as a
cache of the git branch, but OpenCode keeps the conversation in the sandbox's
home directory. On the next message `ensure-sandbox.ts` recreates the sandbox,
clears `Chat.sessionId`, and replays no history (`history.ts` replays only on an
agent switch or a fork), so the agent starts with the system prompt and the new
message alone.

Evidence from production, consecutive metered turns since 2026-09-22:

| Idle gap before the next message | Turns that started a fresh session |
|---|---|
| under 5 min | 0 of 63 |
| 5-10 min | 7 of 9 |
| 10 min or more | 25 of 26 |

Before 2026-09-22, 0 of 3 did. 35 of 98 replies came more than 5 minutes after
the previous turn ended. The 60 fresh mid-chat sessions are exactly the 60
backdated sessions in defect 3. In those turns: "can you check again" got
"What specifically would you like me to check again?"; Wayne's "please
continue" after a 25-minute stop got "The session has no prior context to
continue from"; others opened by rebuilding context from `git log`, and the
pricing-bot agent reinstalled LibreOffice and re-downloaded supplier sheets into
each "fresh sandbox". It also feeds the 18:1 cache-read ratio and the 18 tool
calls per turn, since each fresh turn re-explores.

**Fixed (2026-10-28).** `history.ts` now replays the chat's own history
whenever the chat has earlier assistant turns but no session to resume, which
is what `ensureSandboxForChat` leaves after it rebuilds a sandbox for a message
or for a git action. The replay is capped to the most recent messages that fit
in 40,000 characters, any single message over 8,000 characters is clipped, and
it always opens on a user message. Only message text carries over; tool results
from earlier turns do not, so an agent may still re-run a lookup. Agent switch
and fork replays are unchanged. Carrying OpenCode's session store across
sandboxes and resuming with `-s` stays the fuller option if replay proves too
lossy; keeping sandboxes longer is not an option under the six-sandbox cap.
The sandbox image now ships `libreoffice-calc-nogui`, so the pricing bot's
`soffice --convert-to pdf` works in a fresh sandbox; it takes effect at the
next snapshot rebuild. The check after release: in production, turns sent more
than 5 minutes after the previous one should answer follow-ups such as "please
continue" from the conversation instead of asking what it was about.

**Turn limit raised (2026-10-28).** At the user's request the interactive hard
stop is now 90 minutes, up from 25; the warning comes at 85 and the stop
message is built from the constant. The per-minute lifecycle cron is also what
keeps a running sandbox from idling out, so nothing else needed to change.
Scheduled runs keep their 20 minutes. The workspace's `wait_job.py` still gives
up after 12 minutes and its skill still says to end the turn, which was sized
for the old limit.

## 3. Order of work

1. 2.1 blank turns, 2.8 image, 2.5 budgets — one short PR each, no behaviour
   change in the agents.
2. 2.3 skill source of truth and the push path — in `agent-workspaces`,
   coordinated with the engine's skill.
3. 2.2 write receipts, then 2.6 auto-merge of doc paths.
4. 2.4 job waiting, 2.7 skill shrink.
5. 2.9 model experiment once the org key exists; 2.10 write gate last.

## 4. Known gaps in this investigation

- Turn time is estimated from the ledger row's timestamp minus the prompt,
  for the 136 turns that were metered; the message itself still carries the
  prompt's timestamp (`persist-turn.ts`).
- `packages/web/.env.local` points at a stale Neon copy, not production. Any
  future measurement should use the Supabase URL from Vercel's production env.
- The 2b classifier figures (about 36 true writes, about 8 misses) come from
  reading the flagged commands by hand, not from a labelled set.
- The Instantly audit log was read for 4-28 October only.
- The marketing-automation workspace runs on fixtures (`MARKETING_MOCK=1`),
  so its chats say nothing about live behaviour and were excluded from the
  per-model table except for counts.
