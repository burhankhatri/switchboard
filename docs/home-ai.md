# Workspace home AI

Home Ask agent actions and visible pencil buttons open editable prompt popovers. Sending runs the workspace's configured agent and model without navigating away. Summary, chart, note and other widget changes arrive as complete records are generated and saved. Chat pencils create or update a home representation; they do not rewrite messages. Findings have their own targeted editor.

Suggestions are available on both empty and populated homes. They compare recent conversation evidence with existing components, show rendered previews, and create or update only after acceptance. Proactive findings appear separately and refresh after completed conversations without requiring a suggestion click.

## Runtime and credentials

The implementation uses the existing chat credential resolver, shared credential pools, custom endpoint mapping and shared-budget checks. It uses the workspace's `agent` and `model`. No OpenRouter key is needed. Proactive work runs as the author of the latest completed chat when they remain a member, otherwise a current member.

Operations persist context, sandbox/session identity, stages, validated plans and write receipts. Home visits run a recoverable worker through Next.js `after`; the existing agent-lifecycle cron is the fallback when no browser is open. Workers use leases and row locks. Each widget and receipt commit together; retries resume after committed records. Cancellation stops later writes and tears down the sandbox. Already saved changes remain visible.

The agent receives a bounded extractive context in a temporary sandbox, with its model credentials but without workspace API connections or the workspace repository. The server validates and applies its structured output. This home action does not run external workflows or change remote systems. Runs time out after ten minutes. Session usage is recorded through the existing token ledger.

## Conversation access and coverage

As approved for this change, home AI can derive team-visible findings from any user's chats in the selected workspace, including unshared chats. The homepage explains this policy. Raw transcript authorization remains unchanged; source links are omitted when the transcript is not workspace-readable.

Context currently includes up to forty recent completed conversations, twelve messages per conversation, 1,800 characters per message and 90,000 characters of conversation text overall. Digests retain message IDs, authors and dates. Current widgets and existing findings are included. Missing context must not be interpreted as evidence of resolution.

Proactive work is debounced for five minutes per workspace. The lifecycle cron discovers recent completed chat activity; viewing home also discovers older workspaces needing an initial refresh. It does not silently rewrite authored widgets. Suggestions and accepted previews use the same validated write path; stale update previews are refused rather than overwriting newer edits.

## Deployment

1. Apply the additive `20261028180000_home_ai` migration through the normal deployment workflow using `DIRECT_URL`.
2. Deploy the app. Keep the existing Daytona configuration, active snapshot, credential settings and lifecycle cron.
3. Verify one real create, edit, accepted suggestion and proactive refresh with the intended workspace credentials.

No sandbox-image rebuild is required. Set `HOME_AI_ENABLED=false` to disable new AI generation during rollback; keep persisted widget data. Disable dispatch only after stopping outstanding operations, so existing sandboxes can be cleaned up.

## Verification

- `node scripts/check-home-ai-browser.mjs` (from `packages/web`) bundles the production home components and tests a deterministic HTTP fixture in Chromium: prompt rewriting, no navigation, summary creation, live edits, preserved content, preview/accept, two viewers and mobile/reduced-motion layout. Screenshots are written to `test-results/home-ai/`.
- `node scripts/check-home-ai-db.mjs` uses `.env.test` only when its database is on localhost. It creates a uniquely named scratch database, applies all migrations, exercises actual database transactions, and removes only that scratch database. It never resets the configured database.
- Unit tests cover complete-record parsing, evidence grounding, component targeting, credential/model reuse, budget rejection, reconnects, failed-start cleanup, membership gates, duplicate acceptance and partial recovery.

The browser fixture and database checks do not call a real model or Daytona. Live provider execution and production deployment are separate checks, not implied by these tests.
