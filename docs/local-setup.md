# Local setup

Getting Switchboard running on your machine. Should take about fifteen minutes.

## 1. Clone and install

```bash
git clone https://github.com/burhankhatri/switchboard.git
cd switchboard
npm install
```

Node 20+.

## 2. Create a local database

**Use your own Postgres, not the shared one.** The E2E suite runs
`prisma migrate reset --force`, which drops every table — it refuses to run
against anything but localhost, and that guard is the only thing between a test
run and a wiped production database. Do not remove it.

```bash
createdb -h localhost switchboard_dev
createdb -h localhost switchboard_test
```

Then apply the schema:

```bash
cd packages/web
DATABASE_URL="postgresql://$(whoami)@localhost:5432/switchboard_dev" \
DIRECT_URL="postgresql://$(whoami)@localhost:5432/switchboard_dev" \
npx prisma migrate deploy
```

## 3. Create the env files

Four files. Two are empty on purpose — the npm scripts pass them to
`dotenv-cli`, which errors if a named file does not exist.

```bash
touch .env                 # repo root, stays empty
touch packages/web/.env    # stays empty
```

### `packages/web/.env.local` — your dev config

This is the file that matters. Next.js loads it automatically and it takes
precedence over `.env`.

```dotenv
# Local database. Yours, not the shared one.
DATABASE_URL="postgresql://YOUR_MAC_USERNAME@localhost:5432/switchboard_dev"
DIRECT_URL="postgresql://YOUR_MAC_USERNAME@localhost:5432/switchboard_dev"

NEXTAUTH_URL="http://localhost:4000"
WORKSPACES_REPO="burhankhatri/agent-workspaces"

# --- ask Burhan for these four ---
NEXTAUTH_SECRET="<ask>"
ENCRYPTION_KEY="<ask>"
GITHUB_CLIENT_ID="<ask>"
GITHUB_CLIENT_SECRET="<ask>"
DAYTONA_API_KEY="<ask — only needed to actually run an agent>"

# --- Web Push. Optional: leave unset and push quietly turns itself off ---
VAPID_PUBLIC_KEY=BHpE_DtH1taSnRkJuDKFiYIvBaPVMefgW60Jf35TZrc-LNqDv8Qx3L1YsSjpSButSZi_ae7RddYS6kQhnmC4MFc
VAPID_SUBJECT=mailto:burhanuddinkhatri@gmail.com
# VAPID_PRIVATE_KEY — ask Burhan, or run `npx web-push generate-vapid-keys`
# for your own pair (then the public key above must be replaced too).
```

### `packages/web/.env.test` — for the E2E suite

```dotenv
DATABASE_URL="postgresql://YOUR_MAC_USERNAME@localhost:5432/switchboard_test"
DIRECT_URL="postgresql://YOUR_MAC_USERNAME@localhost:5432/switchboard_test"
NEXTAUTH_URL="http://localhost:4000"
ENABLE_TEST_AUTH="true"
NEXTAUTH_SECRET="anything-works-here"
ENCRYPTION_KEY="anything-works-here"
GITHUB_CLIENT_ID="unused-in-tests"
GITHUB_CLIENT_SECRET="unused-in-tests"
WORKSPACES_REPO="burhankhatri/agent-workspaces"
```

`ENABLE_TEST_AUTH` unlocks `POST /api/test/auth`, which mints a session cookie
so tests are not stopped by the sign-in wall. It is never set in production.

All four files are gitignored (`.gitignore` lines 19–21).

## 4. Run it

```bash
npm run dev          # http://localhost:4000
npm test             # unit tests
npm run typecheck
npm run test:e2e -w @switchboard/web
```

First E2E run also needs `npx playwright install chromium`.

## 5. Sign in

Sign-in is GitHub OAuth only. Two things have to be true:

- The GitHub OAuth app needs `http://localhost:4000/api/auth/callback/github`
  in its callback URLs. Ask Burhan to add it if sign-in bounces back.
- `agent-workspaces` is public, so no repo access is needed to read workspace
  files. Pushing to it does need write access.

Workspaces are invite-only: you will sign in to an empty picker until someone
adds you. That is expected, not a bug.

## What to ask Burhan for

Five values, and none of them should travel over anything public:

| Variable | Why |
|---|---|
| `NEXTAUTH_SECRET` | signs session cookies |
| `ENCRYPTION_KEY` | AES key for workspace connection secrets |
| `GITHUB_CLIENT_ID` | OAuth app |
| `GITHUB_CLIENT_SECRET` | OAuth app |
| `DAYTONA_API_KEY` | only to actually run an agent in a sandbox |

`NEXTAUTH_SECRET` and `ENCRYPTION_KEY` can be any random strings for purely
local work — they only need to match production if you point at the production
database, which you should not.

## The one rule

**Never point `DATABASE_URL` at the Neon URL and then run the E2E suite.**
`prisma migrate reset --force` drops every table. `e2e/global-setup.ts` checks
the datasource Prisma actually resolved and refuses anything non-local, but do
not rely on it alone — keep the Neon URL out of your local files entirely.
