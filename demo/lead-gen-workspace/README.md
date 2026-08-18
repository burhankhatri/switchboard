# Lead Gen — demo workspace

A ready-to-run Switchboard workspace for a hackathon demo. An agent pulls leads
from a **CRM**, scores them against an **Ideal Customer Profile (ICP)**, and
returns a ranked shortlist with reasons.

- **Data source:** [DummyJSON](https://dummyjson.com/users) — a free, public,
  **no-API-key** mock API (100 realistic people with company/title/department).
- **Offline safety:** if the network is down, the scripts fall back to
  `scripts/seed-leads.json`, so the demo works even on flaky hackathon wifi.
- **No secrets required** — `workspace.yaml` has `env: []`.

## Files

```
workspace.yaml                              name, agent, system prompt
.claude/skills/lead-gen-guide/SKILL.md      how the agent qualifies leads
scripts/fetch_leads.mjs                     pull leads (live API + offline fallback)
scripts/score_leads.mjs                     rank leads 0–100 by ICP fit
scripts/seed-leads.json                     offline fallback data (14 leads)
```

## Install it into your workspaces repo

The app clones `workspaces/<slug>/` from `WORKSPACES_REPO`, so the folder must
live there. Two ways:

**A. Git (fastest)** — copy this folder into your workspaces repo as
`workspaces/lead-gen/` and push:

```bash
# in a clone of burhankhatri/agent-workspaces
mkdir -p workspaces/lead-gen
cp -r <this-repo>/demo/lead-gen-workspace/* workspaces/lead-gen/
cp -r <this-repo>/demo/lead-gen-workspace/.claude workspaces/lead-gen/
git add workspaces/lead-gen && git commit -m "Add lead-gen demo workspace" && git push
```

**B. In the app** — create a workspace named "Lead Gen", then use the file
editor to add `scripts/` and paste each file's contents (it commits to the repo
for you).

## Try the scripts locally (optional smoke test)

```bash
cd workspaces/lead-gen        # or demo/lead-gen-workspace
node scripts/score_leads.mjs --top 10
node scripts/fetch_leads.mjs --limit 5
```

## Demo talk-track

1. Open the **Lead Gen** workspace and start a chat.
2. Prompt: **"Find me the 10 best leads to reach out to this week and tell me why."**
   - The agent finds the `lead-gen-guide` skill, runs `score_leads.mjs`, and
     returns a ranked table with per-lead reasons.
3. Follow-up: **"Just the ones in Engineering leadership."** or
   **"Draft a first-touch email to the top lead."**
4. Point out the payoff: no setup, no keys, the whole team gets the same
   qualified list from one workspace.

To simulate "our CRM is down" resilience, run any script with a bad base URL:

```bash
LEADS_API_BASE=https://invalid.invalid node scripts/score_leads.mjs --top 5
# → falls back to seed-leads.json automatically
```

## Point at a real CRM later

The scripts read `LEADS_API_BASE` (default `https://dummyjson.com`). Swap in a
real endpoint that returns the same `users[]` shape, and add its key as a
workspace connection (e.g. `CRM_KEY`) — no script changes needed for the base.
