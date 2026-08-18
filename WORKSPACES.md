# Workspaces — what this app is for

## The problem

Someone on the team works out how to do a job with an agent. They write the
prompt, get the scripts right, wire up the API keys, learn which mistakes the
model makes. It works.

Then a colleague wants to do the same job, and none of it transfers. They need
their own Claude subscription. They need their own API keys for the CRM, the ad
platforms, whatever the job touches. They need the scripts, which live on the
first person's laptop. They need to be told the things that were learned the
hard way. In practice the transfer never happens, so five people solve the same
problem five times, or four of them don't bother.

**A workspace is that whole setup, made transferable.** The person who built it
adds a colleague by GitHub username. The colleague opens it and it works — no
subscription of their own, no keys, nothing to install, nothing to copy.

## What a workspace actually is

A folder in one GitHub repo, plus a row in the database that says who may use it
and what credentials it carries.

```
agent-workspaces/                              ← one repo, the source of truth
  .claude/skills/                              ← skills shared by EVERY workspace
  workspaces/
    marketing-automation/
      workspace.yaml                           ← name, agent, system prompt
      .claude/skills/<name>/SKILL.md           ← how the agent does this job
      lib/                                     ← client code
      scripts/                                 ← what the agent runs
      fixtures/
    lead-gen/
      ...
```

When a run starts, the sandbox clones that folder and sets the agent's working
directory to it. Claude Code looks for skills in `.claude/skills/` in the
current directory **and every parent up to the repo root**, so the workspace's
own skills and the shared ones both load with no extra configuration. That is
the whole mechanism — the directory layout is the feature.

## The three things a workspace carries

**1. Skills — the knowledge.** `SKILL.md` is where "we tried the obvious thing
and it was wrong" lives. The marketing workspace's skill says that Meta's
`update_budget` takes cents, so passing dollars is a 100× error; that a `null`
CPA means no conversions and must not be printed as `0`; that brand search
always shows a spectacular ROAS because the demand already existed, so don't
recommend more budget into it. None of that is in an API doc.

**2. Scripts — the working code.** Committed, version-controlled, and preferred
over the agent writing its own. The system prompt says so explicitly. This is
what stops five people getting five subtly different answers.

**3. Connections — the credentials.** Registered once by the owner, encrypted at
rest, injected into the sandbox as environment variables at run time. The agent
is told what each connection is and how to authenticate with it; it is never
shown a secret in the UI, and no member ever sees one either.

## Adding someone

Owner, in the workspace's **People** panel: type their GitHub username, press +.

That is the entire onboarding. They immediately have the skills, the scripts and
the credentials. Membership is re-checked on every run, not just at bind time,
so removing someone revokes their access to the credentials on their next
message rather than at their next login.

Requirement: they must have signed in to Switchboard once, because a membership
row needs an account to point at. "Ask them to sign in" is a real answer;
inventing a placeholder account would not be.

**Roles.** `owner` may change settings, connections and members. `member` may
run. The last owner cannot be removed or demoted — a workspace with no owner
cannot be administered by anyone.

---

# Blueprint 1 — Marketing Automation

**Job:** report on and optimise paid acquisition across Google Ads and Meta Ads.

**Connections:** `google-ads` → `https://googleads.googleapis.com/v18`,
`meta-ads` → `https://graph.facebook.com/v21.0`. Both bearer-auth.

**Try it:**

> Pull the last 30 days across Google and Meta. Which campaigns should we cut?

The agent reads the skill, runs `python scripts/ads_report.py`, and gets one
normalised table across both platforms.

**Why the scripts exist.** The two APIs disagree about almost everything. Google
returns cost in *millionths* of the account currency and batches its rows inside
a `searchStream` envelope. Meta returns every metric as a *string* and buries
conversions in an `actions[]` array keyed by `action_type`. Getting either wrong
produces numbers that look completely plausible and are silently wrong by a
factor of a million. `lib/google_ads.py` and `lib/meta_ads.py` do that
conversion once, so every script above them sees one shape.

**Mock mode.** `MARKETING_MOCK=1` (the default) serves `fixtures/` instead of
calling out. The fixtures are stored in the platforms' *real* response shapes —
`costMicros`, batched results, stringified metrics, `actions[]` — because a
fixture that invents its own shape would exercise none of the normalising, which
is the part most likely to be wrong against production. `MARKETING_MOCK=0` sends
the identical call over HTTPS to the connection's base URL with its token. Going
live is an environment change and a credential swap, not a code change.

# Blueprint 2 — Lead Gen

**Job:** pull prospective leads, score them against an ICP, return a ranked
shortlist with reasons.

**Connections:** none. The demo CRM is a free public API with no key, which
makes this the workspace to show first — it proves the model works before
credentials enter the story.

**Try it:**

> Pull 30 leads and give me the top 10 by ICP fit, with your reasoning.

**The detail worth copying:** `scripts/fetch_leads.mjs` calls the API with an
8-second timeout and falls back to bundled seed data if the network is
unavailable. A demo cannot be broken by bad wifi.

---

## Suggested demo order

1. **Open Lead Gen, ask for a shortlist.** Establishes what a workspace is when
   nothing is secret. The agent uses committed scripts, not improvised code.
2. **Open Marketing Automation, ask about ad spend.** Now credentials are in
   play. Show `WORKSPACES.md` § connections: the agent gets env vars, the humans
   never see a token.
3. **Add someone in the People panel by GitHub username.** They refresh and the
   workspace is there, working, with no setup on their side. This is the point.
4. **Remove them.** Access is gone on their next run.
