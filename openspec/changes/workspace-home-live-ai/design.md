## Context

See proposal.md for motivation. HomeView passes Ask agent into onNewChatWithPrompt; WidgetGrid supplies summary/chart prompts. WidgetCard hides manual editing in its menu. useWorkspaceHome polls every 60 seconds. The existing schema supports eleven widget types and MCP pin/update tools already validate and attribute writes. TimelineBody is a dated text list. chat-visibility.ts permits shared and scheduled transcripts only. The implemented home spec remains in an unarchived change.

## Goals / Non-Goals

**Goals:** reuse widget schemas and persistence; make asynchronous work durable and observable; ground outputs in bounded workspace context; support multiple viewers and competing edits.

**Non-Goals:** rewriting historical chat messages, granting raw private transcript access, modifying external systems from home suggestions, or deploying during planning. Interpret the requested pencil on chat content as editing home representations of chats; all widget types, including charts, are covered.

## Decisions

1. Add a shared home prompt popover and operation controller. Context includes action, target id/version, current content and editable scenario prompt. Keep manual editing as a secondary action. Reusing chat navigation cannot meet the stay-on-home requirement.
2. Persist home operations with initiating member, workspace, target versions, prompt, stages, sequence, result ids and terminal status. Use the workspace-configured agent/model with the existing chat credential resolver, custom endpoints and shared-pool budget checks. Run it through the SDK in an ephemeral sandbox with only supplied conversation context and no workspace API connections. Persist the sandbox/session before starting; recover through home visits and the lifecycle cron. Complete newline-delimited output records are validated and committed by the server while later records are still being generated. Meter usage with the existing session ledger and delete the sandbox on completion/cancellation. No new provider key is required.
3. Use durable sequenced operation events with resumable streaming and bounded polling fallback; invalidate or patch the home cache after each committed widget update. Stream stage feedback and validated content boundaries, not incomplete JSON. Preserve existing content beneath a subtle active-edit treatment. Show stages such as reading conversations, preparing changes and saving, not invented percentages. Recover from disconnects using persisted state.
4. Build bounded server-side retrieval across all chats with the exact workspaceId, cached extractive conversation digests and evidence references. Treat transcript content as data, never new instructions. The requested policy permits shared insights from unshared workspace chats; disclose this in the product, while retaining existing raw transcript permissions and checking source-link visibility separately.
5. Store suggestions with create/update intent, target version, structured preview, rationale, evidence and accepted/dismissed state. Include all existing widget identities and compact content in generation context. Accept through the same operation path, using idempotency and version checks. Enforce the 40-widget cap for creates, while still allowing update suggestions at capacity.
6. Discover completed conversation turns on home visits and lifecycle cron ticks, then enqueue debounced insight refresh; use durable pending work and a recoverable worker/cron path. Cache by context version, bound input and run frequency, and avoid refreshing in response to the insight operation's own writes. Proactive insight cards update automatically; suggested changes to authored widgets require acceptance. Findings use stable identities and evidence-backed statuses.
7. Redesign milestones with icons, date groupings, status pills, concise cards and expandable details. Add content-shaped initial skeletons, active-card progress, completion transitions, keyboard focus management and reduced-motion support. Existing content remains readable throughout.

## Risks / Trade-offs

- Derived private-chat content becomes shared -> explicit policy copy and isolation tests; raw source access remains separately enforced.
- Cross-member edits or repeated acceptance overwrite content -> compare versions and idempotent writes; regenerate stale previews.
- Long histories increase cost and delay -> incremental bounded digests, debouncing and cached suggestions; communicate incomplete coverage.
- Agent errors or disconnected tabs leave apparent success -> durable terminal states, partial-write receipts, reconnect and cancellation checks before each write.
- Existing home specs conflict -> reconcile summary navigation, refresh and derived-content privacy scenarios in the predecessor change during implementation before archival.

## Migration Plan

Add operation/event, suggestion and insight persistence additively. Preserve existing widget rows and schemas where possible. Gate new execution during rollout, validate both fresh and populated workspaces, then enable live home actions. Rollback disables new actions/workers and restores existing rendering while retaining existing widgets and operation records. No sandbox-image rebuild unless implementation changes that package.
