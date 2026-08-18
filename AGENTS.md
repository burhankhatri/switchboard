# Agent instructions

Primary reference for coding agents working in this repo.

- **What this is, decisions, status, next steps**: [PROGRESS.md](./PROGRESS.md)
- **Capability specs**: `openspec/specs/` — read these before changing behaviour
  in that capability. Use `/opsx:propose` for a change that alters a spec.

## What this project is

Switchboard: shared agent workspaces. A **workspace is a folder in one private
git repo** (`WORKSPACES_REPO`) carrying the skills, scripts and connections for
one kind of work. A run spawns a Daytona sandbox, sparse-clones that folder, and
starts a headless agent with its cwd inside it.

Derived from switchboard (Apache-2.0, see NOTICE).

## Setup

Secrets live in **`packages/web/.env.local`, which is tracked in this repo** — do
not expect them in the shell and do not recreate the file. It holds
`DATABASE_URL` + `DIRECT_URL`, `DAYTONA_API_KEY`, GitHub OAuth,
`NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `WORKSPACES_REPO`.

```bash
npm install && npm run prisma:generate
npm run dev            # http://localhost:4000
```

## After editing code

```bash
cd packages/web && npx tsc --noEmit -p tsconfig.json
```

**There are 21 pre-existing type errors**, all in `components/sidebar.tsx`,
`lib/hooks/usePaletteProps.ts` and `app/page.tsx` — a filename-casing conflict on
case-insensitive filesystems. Compare the count against 21; do not try to reach
zero and do not treat them as yours.

```bash
cd packages/web && npx vitest run        # 187 tests; run from packages/web, the @/ alias breaks from the repo root
```

## Verifying real behaviour

Neither of these is a unit test — both hit real infrastructure.

```bash
# spins a real sandbox, sparse-clones, runs the agent, asserts skill discovery + isolation
WORKSPACE_PATH=workspaces/lead-gen npx dotenv -e packages/web/.env.local -- node scripts/slice-zero.mjs

# 36 assertions against the real HTTP API (needs the dev server up); creates a real
# workspace and commits a real folder
cd packages/web && GH_TOKEN=$(gh auth token) npx dotenv -e .env.local -- node ../../scripts/e2e-workspace.mjs
```

## Things that will bite you

- **Two sidebars.** `components/Sidebar.tsx` renders separate mobile and desktop
  trees. A change to one is invisible on the other.
- **Migrations need `DIRECT_URL`.** Neon's pgbouncer pooler cannot take the
  advisory locks `prisma migrate` requires.
- **`repoPath` means the clone root, everywhere.** The agent's cwd is a
  subdirectory of it. Conflating them makes the agent commit from a folder it
  believes is the repo root.
- **Workspace connections merge LAST**, above user variables. This is deliberate
  and is an authorization boundary — see `openspec/specs/workspace-connections`.
- **Secrets use `encryptSecret`/`decryptSecret`, not `encrypt`/`decrypt`.** The
  plain pair returns ciphertext on failure, which would be sent to the CRM as a
  credential.
- **Rebuilding the sandbox image** (`npm run build:snapshot`) is only needed when
  `packages/sandbox-image` changes. The image has `python3` but **no `pip`** and
  **no `gh`**.
