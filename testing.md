# Testing Guide

How to run every suite in this repo. Written for someone with a clean checkout.

## Environment Setup

- **Package manager:** npm (workspaces monorepo, no `packageManager` pin)
- **Node:** 20+
- **Database:** PostgreSQL. Production/dev uses Neon; **tests use a local
  database and nothing else** — see the safety note below.
- **Services:** Daytona (sandboxes) and GitHub OAuth for the full app. E2E pins
  the agent to **Eliza**, a local regex-based fake agent, so tests do not depend
  on model availability, API keys, or daily-limit windows.

### Required env vars

Unit tests need none. E2E reads `packages/web/.env.test` (gitignored), which
`playwright.config.ts` loads before `../../.env.local`:

| Var | Why |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | **Must point at localhost.** See safety note. |
| `ENABLE_TEST_AUTH=true` | Unlocks `POST /api/test/auth`, which mints a session cookie. Without it every E2E test hits the sign-in wall. |
| `NEXTAUTH_SECRET` | Signs that session token. |
| `NEXTAUTH_URL` | `http://localhost:4000` |
| `ENCRYPTION_KEY` | Workspace connection secrets are AES-encrypted at rest. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | NextAuth provider config at boot. |
| `WORKSPACES_REPO` | Where workspace folders live. |
| `DAYTONA_API_KEY` | Only needed by tests that actually spin a sandbox. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. **Optional** — with these unset, push degrades to a no-op and the "Enable push" control hides itself, so the rest of notifications works unchanged. Generate a pair with `npx web-push generate-vapid-keys`; `VAPID_SUBJECT` is a `mailto:` or https URL identifying the sender. |

### Creating the test database

```bash
createdb -h localhost switchboard_test
```

> **Safety.** `e2e/global-setup.ts` runs `prisma migrate reset --force` before
> every E2E run, which **drops every table**. It refuses to run unless
> `DATABASE_URL` contains `localhost` or `127.0.0.1`. Do not set
> `I_KNOW_THIS_IS_THE_TEST_DB=true` to get around that unless you mean it.

## Running Tests

### Unit tests (vitest)

```bash
npm test                      # from repo root
npm run test -w @switchboard/web
npx vitest run lib/session.test.ts   # single file, from packages/web
```

Location: colocated `*.test.ts` next to the code, not a `tests/` tree — e.g.
`packages/web/lib/session.test.ts`, `packages/web/lib/git-policy.test.ts`.

### E2E tests (Playwright)

```bash
npm run test:e2e -w @switchboard/web
npx playwright test --ui                  # interactive
npx playwright test e2e/notifications.spec.ts
```

Setup: `npx playwright install chromium`
Base URL: `http://localhost:4000` — Playwright starts the dev server itself
(`webServer` in `playwright.config.ts`) and reuses a running one outside CI.
Location: `packages/web/e2e/`

Authenticate inside a test with the shared helpers:

```ts
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"
await setupTestAuth(page, context)
await setDefaultAgentEliza(page)
```

### Typecheck

```bash
npm run typecheck             # all workspaces
```

## Debugging Failed Tests

- Single test by name: `npx playwright test -g "shows an unread badge"`
- Headed browser: `npx playwright test --headed`
- Traces: `npx playwright show-trace test-results/*/trace.zip`
- Vitest watch: `npx vitest lib/notifications.test.ts`
- Flake check: `npx playwright test --repeat-each=3`

## Conventions worth knowing

- **Interval guards.** `lib/cron-schedule.test.ts` fails any cron under 10
  minutes, and `lib/query/hooks/*.test.ts` assert poll intervals as pure
  functions. Neon suspends a compute after 5 minutes idle, so anything polling
  faster keeps the database awake 24/7 and bills for it. That failure is silent
  — nothing breaks, the invoice just arrives — which is why it is tested.
- **Skipped is failing.** A run reporting "7 passed, 18 skipped" is not green.
