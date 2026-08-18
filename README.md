# Switchboard

Shared agent workspaces.

Someone on the team writes a few scripts and prompts that handle a chunk of
their job. That work ends up trapped on their laptop: to reuse it a colleague
needs their own agent subscription, the same API keys, and a replicated
environment. In practice nobody does that, so every useful automation stays a
personal tool.

Switchboard is one place the team reaches. **A workspace is a folder in a private
git repo** carrying the skills, scripts and connections for one kind of work.
Pick a workspace and an agent runs it in a disposable sandbox with everything
already loaded — no setup, no keys to copy, nothing to stand up.

---

## How a run works

```
person picks a workspace
  └─ membership checked, then a Daytona sandbox from a prebuilt snapshot   ~2s
       ├─ sparse clone: THIS workspace + the shared root         ~165KB
       ├─ connections injected (CRM_KEY, …) — never held by the person
       └─ agent starts with cwd INSIDE the workspace folder
            └─ its skills and the shared skills load automatically
```

The last line is the trick the whole design rests on. Claude Code discovers
`.claude/skills/` in the working directory **and every parent up to the repo
root**, so putting the agent's cwd inside the workspace folder gets both that
workspace's skills and the shared ones — no extra flags, no config.

## The workspaces repo

Workspaces live in a separate private repo (`WORKSPACES_REPO`):

```
.claude/skills/            shared — loads in every workspace
workspaces/
  marketing-automation/
    .claude/skills/        this workspace only
    scripts/
    workspace.yaml
  lead-gen/
    ...
```

Adding a workspace is `mkdir`. Editing a skill in the UI commits to this repo,
so the repo stays the single source of truth and an edit cannot drift from what
the next run clones.

## Quick start

Requires Node 20.9+. Secrets are in `packages/web/.env.local`, which is tracked
in this repo — you do not need to create it.

```bash
npm install
npm run dev          # http://localhost:4000
```

Sign in with GitHub, create a workspace, and it is immediately runnable.

To verify against real infrastructure rather than mocks:

```bash
# spins a real sandbox, clones, runs the agent, asserts skill discovery + isolation
WORKSPACE_PATH=workspaces/lead-gen npx dotenv -e packages/web/.env.local -- node scripts/slice-zero.mjs

# 36 assertions against the running HTTP API
cd packages/web && GH_TOKEN=$(gh auth token) npx dotenv -e .env.local -- node ../../scripts/e2e-workspace.mjs
```

## Where things are

| | |
|---|---|
| [PROGRESS.md](./PROGRESS.md) | Architecture, decisions and why, what is verified, what is next |
| [AGENTS.md](./AGENTS.md) | Orientation for coding agents, and the traps |
| [CLAUDE.md](./CLAUDE.md) | Commit and working conventions |
| `openspec/specs/` | What each capability must do, as testable requirements |
| `packages/web` | The app — Next.js, Prisma, NextAuth |
| `packages/sdk` | Agent registry and background sessions. Swapping Claude Code for OpenCode is one config value |
| `packages/sandbox-*` | Sandbox primitives: git, job control, images, terminal |

## Status

Working end to end and verified: workspace creation, membership, connections,
file browsing and editing, sparse-cloned runs with skill discovery. 187 tests.

Not done yet: gated joining, member removal, workspace-filtered chat history,
and scheduled runs are wired but untested. See
[PROGRESS.md](./PROGRESS.md#next).

Built on [background-agents](https://github.com/jamesmurdza/background-agents)
(Apache-2.0) — see [NOTICE](./NOTICE).
