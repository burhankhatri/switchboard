# Switchboard — progress

Shared agent workspaces for Live Energy. A **workspace is a folder in one private
git repo** carrying the skills, scripts and connections for one kind of work.
Pick a workspace, an agent runs it in a disposable sandbox with everything
already loaded — no per-person setup, no per-person subscription.

Built on a fork of [burhankhatri/switchboard](https://github.com/burhankhatri/switchboard).

---

## How it works

```
person picks a workspace
  └─ POST /api/chats { workspaceId }        membership required
       └─ Daytona sandbox from a prebuilt snapshot          ~2s
            ├─ sparse clone: THIS workspace + repo-root .claude   ~165KB
            ├─ env: workspace connections (CRM_KEY, …) injected last
            └─ claude -p, cwd INSIDE the workspace folder
                 └─ skills auto-discovered (workspace + shared)
```

**Why cwd matters:** Claude Code discovers `.claude/skills/` in the working
directory *and every parent up to the repo root*. Setting cwd to the workspace
folder gets both the workspace's own skills and the shared ones for free — no
`--add-dir`, no config.

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Workspace unit | Folder in one repo | N images means N build pipelines; one repo makes "join" a DB row, not a GitHub invite |
| Clone | Sparse, anchored to repo root | A run fetches only its own workspace. Anchoring matters: `--no-cone` patterns are gitignore-style, so bare `.claude` matched at any depth and pulled in every sibling workspace |
| Chat ↔ workspace | Chat denormalises repo/branch/agent at creation | Every existing consumer of `Chat.repo` (clone, auto-push, PR, labels, sidebar) keeps working untouched |
| Env precedence | system < user repo < user chat < **workspace** | The one place "user vars win" is wrong: otherwise a member could shadow `CRM_KEY` and point a shared workspace at a system of record of their choosing |
| Secrets at rest | AES + an in-ciphertext marker | CryptoJS passphrase mode is CBC with **no MAC**; without the marker a wrong key occasionally yields a plausible-but-wrong credential |
| File editing | Saving commits to the repo | Keeps the repo the single source of truth, so an edit and what the next run clones cannot diverge |
| Harness | Claude Code now, OpenCode later | The `AgentDefinition` registry already implements both — swapping is one string. Not a model gateway (unsupported by Anthropic, and CVE-shaped) |

---

## Done

**Core**
- `Workspace`, `WorkspaceMember`, `Chat.workspaceId`, `ScheduledJob.workspaceId` (+ migrations)
- Agent cwd narrows to the workspace folder; workspace system prompt appended after platform rules (fenced, so it cannot reframe them)
- Both entry points resolve workspaces identically — chat and cron are one code path
- `cloneSparse` in `packages/sandbox-git` (partial + sparse clone)

**Workspaces**
- Create from the UI → commits a scaffold folder (config + starter skill) to the private repo, then writes the row. Repo first: a failed commit leaves nothing behind
- Join / leave; last owner cannot leave
- Connections (env) — encrypted, owner-only writes, member-only name reads, **no endpoint returns a value**
- File tree, editor (saving commits, with conflict detection via blob SHA), drag-and-drop upload, new file, new folder

**Product**
- Rebranded: Switchboard, Space Grotesk / Plus Jakarta Sans, amber on warm neutrals
- Workspaces are the home screen; chat controls hidden until one is chosen

**Fixes found along the way**
- `Account.refresh_token_expires_in` — GitHub returns it, the schema lacked it, so **all GitHub sign-in failed** with `?error=Callback`. Upstream bug, worth reporting to James
- Signed-out flash on refresh — `SessionProvider` had no server session, and `loading` was being treated as signed-out
- Bounded retry on GitHub 5xx (found during a real partial outage)
- Upstream: `agent/stop/route.ts` builds a repo path that doesn't exist (latent)

---

## Verified

| What | How |
|---|---|
| Workspace API | 36 assertions, `scripts/e2e-workspace.mjs` (drives real HTTP with a minted session cookie) |
| Secret handling | 14 unit tests, `packages/web/lib/workspace.test.ts` |
| Full stack | 187 tests pass; typecheck at 21 pre-existing errors, 0 new |
| Real sandbox run | `scripts/slice-zero.mjs` — spin-up → sparse clone → skills discovered → isolation asserted |
| Secret delivery | Confirmed `CRM_KEY` reaches the sandbox, a deleted key does not, and the value never appears in the transcript |

**Not verified:** the populated UI end-to-end in a browser (needs a signed-in session), and scheduled runs against a workspace.

---

## Next

1. **Gate joining.** It is open self-service today, but membership is now an authorization boundary for secrets. Needs invite or owner approval.
2. **Remove / promote members.** Neither endpoint exists, so "promote someone else first" (when the last owner tries to leave) points at a capability that isn't there.
3. **Filter the chat list by workspace.** `Chat.workspaceId` exists; it's a `where` clause.
4. **Fail loud on bootstrap.** Claude Code's `system/init` event carries `plugin_errors` and `mcp_server_errors` — abort the run on either instead of proceeding without a skill or tool.
5. **Image:** add `pip` (absent entirely) and `gh`; `python3` 3.11.2 is present. Geospatial libs (`libgeos`, `libproj`, `libspatialindex`) missing if the lead-gen pipeline is wired up.
6. **Finish the rebrand.** Chat view, settings modals and command palette are still structurally switchboard's.
7. **Scheduled runs against a workspace** — wired but untested.
8. **Credential broker.** See below.

---

## Known risks

**The CRM credential is readable by the agent.** It is an env var in a sandbox
running `--dangerously-skip-permissions`, and the agent reads
attacker-influenceable text (Google Places display names are set by whoever
claims the listing). Accepted for the MVP. The real fix is a broker that holds
the credential outside the sandbox and exposes a write *tool* instead of a
*key* — then a prompt-injected agent can decide *whether* the pipeline runs but
never *what* it writes.

**Anthropic credentials are a personal Max subscription.** Fine for a prototype;
it cannot be the mechanism once colleagues use this — subscription sharing, rate
limits, and no per-person cost attribution. Needs an org-billed API key.

**`packages/web` upstream declares no license.** Root `LICENSE` is Apache-2.0
co-held with Daytona Platforms Inc.; five packages declare MIT. Worth asking
James who can confirm in writing.

**Two holes found by adversarial review and fixed** — recorded because they are
the shape of thing to keep watching for:
- Any signed-in user could bind a chat to any workspace and receive its
  decrypted secrets, while being refused even the key names by the env endpoint.
- `decryptStrict` inferred success from "non-empty UTF-8", which a wrong key
  satisfies ~0.2% of the time.

---

## Running it

```bash
npm install
npx dotenv -e packages/web/.env.local -- npm run build:snapshot -w @switchboard/sandbox-image
npm run dev            # http://localhost:4000
```

`packages/web/.env.local` holds `DATABASE_URL` + `DIRECT_URL` (Neon; migrations
need the **non-pooled** host — pgbouncer cannot take migrate's advisory locks),
`DAYTONA_API_KEY`, GitHub OAuth, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`,
`WORKSPACES_REPO`.

```bash
# real sandbox run of a workspace
WORKSPACE_PATH=workspaces/lead-gen npx dotenv -e packages/web/.env.local -- node scripts/slice-zero.mjs

# API integration suite (needs the dev server up)
cd packages/web && GH_TOKEN=$(gh auth token) npx dotenv -e .env.local -- node ../../scripts/e2e-workspace.mjs
```

> **`.env.local` is NOT in this repo and must never be.** It was committed
> briefly while the repo was public; the file has been purged from history and
> every credential in it was rotated. Get the current values from Burhan
> directly.
