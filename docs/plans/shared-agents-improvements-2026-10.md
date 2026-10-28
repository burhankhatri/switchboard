# Plan — make the Switchboard agents considerably better (2026-10-28)

Scope: the GTM Lead Engine and Pricing Bot workspaces as run through Switchboard
(`packages/web`, `packages/sdk`, the `burhankhatri/agent-workspaces` repo). This
is an investigation and a plan, not a code change. Every number below was
measured on 2026-10-28 from the production Neon database (read-only), the
`agent-workspaces` repo at `2585d59`, this repo at `a60c021`, and Instantly's
audit log (read-only). Nothing was sent, pushed, enriched or changed.

## 0. The question, and the verdict

Burhan's hypothesis: *shared-agents is defaulted at GLM, and the way it accesses
data is not optimised; the agents need to be considerably better.*

**Verdict (is-it-bs): partly right, and the two named causes are not the ones
that hurt users most.**

| Claim | Finding |
|---|---|
| "Defaulted at GLM" | **True.** `DEFAULT_HARNESS` is OpenCode on `opencode-go/glm-5.2` (`packages/web/lib/default-harness.ts:8`, `packages/common/src/agents.ts:464`); all 4 workspaces in the DB carry `model = opencode-go/glm-5.2`. But GLM-5.2 ran only 34 of the 77 assistant turns on record. 25 turns ran on the **free** `opencode/big-pickle` (an older default-model bug saved the first model in the list, see `default-model.ts:5-10`), 9 on Claude, 4 on `nemotron-3-ultra-free`, 5 on GLM-5.1. |
| "Data access is not optimised" | **True, but second-order.** The agents re-read 15-26 KB skill files on every turn (31 skill loads + 22 raw `Read SKILL.md` in 46 tool-using turns), re-fetch the 120 KB campaign list (16 times across chats) and the 442 KB lead store (9 dry runs across chats, 3 inside one chat), and poll long jobs inside a single turn (one turn died at the 25-minute limit after 1,602 s of polling). Total model spend across the whole history is **$5.69**, so cost is not the problem; turn length, the $0.50/day shared cap and lost context are. |
| "The agents are poor" | **Mixed.** GLM-5.2 turns were careful: honest zero counts, three refusals to print the token, every push preceded by a preview and a yes. What users actually hit was **harness reliability** (Wayne's first three messages got three blank replies; six Claude Code chats errored with no reply), **not knowing whether an action happened** (four "did you create / did you put / did you update" questions), **stale and contradictory skills**, and **environment friction** (about 20 of the 54 failed tool calls were `jq`/`python`/`requests` missing or a root-owned `/tmp/opencode`). |
| "A teammate's Switchboard agent enrolled 1,016 contacts" (background given to this task) | **Not supported by Switchboard's records.** The DB has no chat, no scheduled run (0 runs ever) and no chat deletion on 6, 12, 14 or 15 October. Instantly's audit log shows campaign `9e8897c8` created by an API key on 2026-10-06 18:08 UTC and filled by API in batches of 42, 61, 401, 173 and 323 (6, 12, 14, 15 Oct), every row `from_api: true` with no user. The same key also removed the 16 leads Switchboard had pushed into draft `7c08d5fb` on 13 Oct. The field mapping (`place_id`, `maps_link`, `contact_source`) is `push_to_instantly.py`'s, which anyone with the workspaces repo can run locally. The bypass is real; attributing it to Switchboard is not. |

Judgment on the ask: **JUSTIFIED** for a plan; **SIMPLIFY** the model part
(drop the free models, keep GLM-5.2, run a bounded Claude experiment on the
write paths) rather than a wholesale model swap.

## 1. What was measured

### Corpus

| | |
|---|---|
| Chats | 38 (gtm-lead-engine 17, pricing-bot 8, marketing-automation 6, smartclusive 2, none 5) |
| Users | Burhan 31 chats, Wayne 4, Abdul Rehman 2, stclair-github 0 |
| Messages | 150 (73 user, 77 assistant); 46 assistant turns used tools |
| Tool calls | 537: Bash 310, Read 78, Edit 75, skill 31, Write 11, Grep 10, pin_to_home 9, other 13 |
| Per tool-using turn | mean 11.7, median 8, max 52 |
| Failed tool calls | 54 (10%) |
| Repeated commands inside one turn | 164 (30%), mostly Edit/Read loops in the 38-52 call turns |
| Scheduled jobs / runs | 0 / 0 |
| Spend (TokenUsage ledger) | GLM-5.2 $4.04 (33 rows, 511K in, 47K out, 10.0M cache reads), Opus 4.8 $0.75, Opus 5.5 $0.56, GLM-5.1 $0.32, big-pickle $0 (385K in, 89K out, 11.1M cache reads) |

Turn latency could not be measured: the assistant message carries the user
message's timestamp (`persist-turn.ts`), so every turn reads as 0 s.

### By model

| Model | Turns | Tool calls | Failed calls | Repeats | Notable |
|---|---|---|---|---|---|
| opencode/big-pickle (free) | 25 | 254 | 36 (14%) | 82 | Named real contacts in chat twice (08-19, 09-25); created an Instantly draft on an ambiguous ask (09-25); one turn ended after loading a skill with "I'll start by exploring" and no work (09-22); 300 s header timeout (09-25) |
| opencode-go/glm-5.2 | 34 | 220 | 13 (6%) | 71 | Honest counts, refused to print the token 3×, previews before every push; hit the 25-min limit polling an enrich job (10-01); edited 5 skills + a script when asked "can you add that in the sequence" |
| opencode-go/glm-5.1 | 5 | 25 | 1 | 1 | Pricing bot: read the scripts, logged into the CRM with the credentials hardcoded in `crm_pricing_bot.py`, flagged that they are hardcoded |
| claude-code (default/opus/haiku) | 9 | 38 | 4 | 10 | 6 further chats errored with no reply ("Not logged in", 08-18; status `error`, 0 messages, 08-20/08-31/09-22×3/09-24) |
| nemotron-3-ultra-free | 4 | 0 | 0 | 0 | Greetings only; one "model request failed" |

### Where users were failed

- **Blank replies.** Wayne's first three messages (pricing-bot, 2026-09-22, same
  prompt three times over 2.5 h) each got an empty assistant message. Cause in
  `ActivityLog`: `Error from provider (Console): OpenCode 1.18.0 or newer is
  required to use the free tier`. Nothing told him. He got his first real
  answer on 09-25 on GLM-5.2. 2 of his 6 messages were answered.
- **Repeated prompts.** Burhan re-sent the pricing-bot prompt (09-22) and the
  "write a campaign sequence" prompt (09-25) after a dead first turn.
- **"Did you do it?"** Four times a user had to ask whether an action had
  happened ("did you create the draft campaign", "did you put that on
  instantly", "did u update the campaign", "name of campaign that u created").
  Once the answer was "no, when you asked it wasn't there, I created it just
  now".
- **Turn killed mid-task.** 10-01, "do it" → 40-building enrichment; the turn
  polled `/api/jobs/{id}` in 40+55-iteration curl loops, hit the 25-minute hard
  timeout (`agent-lifecycle/route.ts:169`) and, two seconds earlier, the shared
  OpenCode daily cap of $0.50 (`usage-budgets.ts:38`, marked PLACEHOLDER; the
  ledger shows $0.58 used). The user typed "continue".
- **Lost context between chats.** A new chat is a fresh sparse clone of `main`,
  but agents commit to `agent/<branch>` and must ask the user to merge. On
  10-01 Wayne's agent found "the campaign spec isn't in the repo (sandbox is
  fresh)" and reconstructed state from Instantly; two LEARNINGS commits ended
  with "please merge it to main".
- **Environment friction.** `python` not found (2), `jq` not found (3 turns),
  `requests` missing (2), `/tmp/opencode` permission denied (5 occurrences in 3
  chats; OpenCode's own tool-output dir is root-owned in the snapshot),
  `nslookup`/`ping` missing, and an egress firewall that reset TLS to
  `api.instantly.ai` on 08-20 and 09-11 (21 tool calls spent diagnosing it).
- **Stale and divergent skills.** The workspace's `lead-engine-api` skill
  differs from the engine repo's own copy by 688 diff lines. The workspace
  copy still says `POST /api/leads/push` is "inert today" and to "push through
  `scripts/push_to_instantly.py` instead" (SKILL.md:66), mentions `chain` once
  (the engine's says six times), and `push_to_instantly.py` has no `chain`
  filter at all. Its "store today" table (518 leads, 2026-09-26) was 6.5× out
  of date by 10-26 (3,390). `pricing-bot-guide/SKILL.md` is still the scaffold
  placeholder; the Pricing Bot system prompt is one sentence.
- **Guardrail drift.** The "only when the user asks in that turn" rule is prose
  repeated in five skills; LEARNINGS entry 29 records the day two copies
  disagreed and a request to enrich came back with nothing done.

### What worked

- Dry-run-first scripts (`push_to_instantly.py`, `create_campaign.py`) and the
  preview checks: every push in the record was previewed and approved.
- The agents found real bugs in their own tools (unsorted paging returned 518
  rows with 305 unique leads; Cloudflare 403 on Python's User-Agent; the
  `campaign_id` filter that Instantly silently ignores) and fixed them.
- The `campaign-review` / LEARNINGS loop produced the dead-sending-domain
  finding that months of manual review had missed.
- `pin_to_home` on 10-26 (Opus): a nine-widget home page from live reads in
  25 tool calls, nothing written.

## 2. The changes, ranked by impact

Each item: what it changes, what it costs, what it is expected to change, and
how to tell. Nothing here needs a new service.

### 2.1 Never return an empty turn (highest impact, lowest cost)

**Problem.** A provider error produces an assistant message with empty
content and `isError = false` (Wayne's three blank replies; the 09-25 header
timeout; the 10-01 nemotron failure). PROGRESS.md "Next" item 4 ("fail loud on
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

**Verify.** Replay the 150 stored messages through the classifier: it must tag
the 09-25 draft creation, the 09-25 and 10-01 pushes, the 10-01 enrichment and
the 9-building skip, and nothing in the read-only chats.

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

**Problem.** Polling an enrich job inside one turn burned 1,602 s, hit the
25-minute limit and the daily cap, and the user had to say "continue".

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
the turn ends under 2 minutes and the follow-up turn reports the result.

### 2.5 Budgets and timeouts set from the ledger, not placeholders

**Problem.** `usage-budgets.ts:38` caps the shared OpenCode pool at $0.50/day
per user and says so is a placeholder. The whole history cost $5.69; the one
day a user did real work it tripped. The 25-minute interactive limit is right
for a runaway, wrong for a sanctioned enrichment.

**Change.** Set the OpenCode budget from the ledger: the heaviest real day
(10-01, Burhan) was about $2.50 across two chats; a $5/day cap per user with a
warning at 80% shown in the composer. Show the remaining budget and the
turn's running time in the UI. Keep the 25-minute limit but make the warning
appear in chat at 20 minutes so the agent can wrap up.

**Cost.** Small: constants plus one UI indicator.

**Expected effect.** No cap trips during approved work; agents stop mid-task
on purpose rather than by kill.

**Verify.** `daily_limit_reached` rows in `ActivityLog` stay at zero over a
month of normal use; `TokenUsage` daily sums stay under $5.

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
files, about 130 KB, before its first data call. GLM's 10.0M cache-read tokens
against 511K input tokens is this pattern.

**Change.**
1. Cut each SKILL.md to the rules and the commands; move tables, histories and
   "what has gone wrong" into `reference/` files the agent opens on demand.
   Target: no SKILL.md over 8 KB (today the four largest are 22-26 KB).
2. Descriptions under 300 characters; the triggers list moves into the body.
3. Give the scripts a compact summary mode (`instantly_report.py --brief`,
   `push_to_instantly.py --counts`) and have the skills prefer it, so an answer
   to "how many can we email" is one call and one screen, not a 442 KB fetch
   parsed in Python heredocs.

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

**Expected effect.** About 20 of the 54 failed tool calls in the record do
not happen.

**Verify.** `which python jq` and `python3 -c "import requests"` succeed in
`scripts/slice-zero.mjs`; `touch /tmp/opencode/x` succeeds.

### 2.9 Model choice per agent: keep GLM-5.2 for reads, test Claude on writes

**Evidence.** GLM-5.2 behaved well on reads and reports at $0.12 a turn. The
free models were where the sloppiness lived (14% failed tool calls, names in
chat, a draft created on an ambiguous ask, an empty "I'll start by exploring"
turn). Claude Code was unusable for most of the period for credential reasons
(personal Max subscription, PROGRESS.md "Known risks"), so there is no evidence
in these transcripts that Claude would have changed an outcome; the one Opus
session (10-26) was good but read-only.

**Change.**
1. Remove `requiresKey: "none"` models from the picker when the workspace has
   a shared key (`SHARED_OPENCODE_ALLOWED` already exists for Go models).
2. Keep `opencode-go/glm-5.2` as the workspace default.
3. Run a bounded experiment: for four weeks, campaign-builder and any turn that
   will call `--apply`, `/api/enrich` or `create_campaign.py --apply` runs on
   Claude (Sonnet 5.5 via the org key once PROGRESS.md's credential item is
   done). Success criterion: fewer than one unapproved write and fewer than one
   "did you…" question per ten write turns, and no privacy slip, versus the
   GLM baseline measured here. If GLM matches it, stay on GLM.

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
stops drifting.

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
end to end). See PROGRESS.md for what was and was not verified.

## 3. Order of work

1. 2.1 blank turns, 2.8 image, 2.5 budgets — one short PR each, no behaviour
   change in the agents.
2. 2.3 skill source of truth and the push path — in `agent-workspaces`,
   coordinated with the engine's skill.
3. 2.2 write receipts, then 2.6 auto-merge of doc paths.
4. 2.4 job waiting, 2.7 skill shrink.
5. 2.9 model experiment once the org key exists; 2.10 write gate last.

## 4. Known gaps in this investigation

- Turn latency is not recorded, so "slow" could not be measured; 2.2's
  classifier should also store turn start and end times on the message.
- The 1,016-contact enrolment was done with an API key outside Switchboard.
  Which key and which machine is not in any record this task could read;
  rotating the Instantly key in the workspace connection would tell whether the
  external runner shares it.
- The Instantly audit log was read for 4-28 October only.
- The marketing-automation workspace runs on fixtures (`MARKETING_MOCK=1`),
  so its chats say nothing about live behaviour and were excluded from the
  per-model table except for counts.
