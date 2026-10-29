## Why

Home AI actions send members into a separate chat and updates can take a minute to appear. The workspace should instead support in-place creation and editing, show actual progress, and proactively surface useful findings from team conversations.

## What Changes

- Contextual, editable prompt popovers for Ask agent and summary generation; send without leaving home.
- Visible pencil actions on widgets, summaries, chart content, notes and home chat-derived content.
- Durable home AI operations with live progress, incremental validated updates, retry and cancellation.
- Suggestions on empty and populated homes, considering existing components and offering creates or updates for acceptance.
- Proactive, source-backed issue and decision cards across members' conversations.
- A more visual timeline and richer loading states during initial loading and AI editing.
- **BREAKING**: home AI may derive workspace-visible insights from any member's chats within that workspace, including chats not explicitly shared. Raw transcript access remains separately controlled; this policy change must be visible to members.

## Capabilities

### New Capabilities

- `workspace-home-ai`: Inline AI operations, contextual suggestions, proactive insights and live visual feedback. Extends the implemented but unarchived `workspace-home` change; reconcile its home summary and privacy scenarios before archiving either change.

### Modified Capabilities

None in the current main specs. The existing home specification lives under `openspec/changes/workspace-home`, not `openspec/specs`.

## Impact

HomeView, WidgetGrid/Card and renderers, home query hooks, workspace home APIs and context retrieval, widget persistence and MCP tools, agent run lifecycle, Prisma operation/suggestion/insight records, and tests. Implementation was authorized after review of this proposal. Deployment remains a separate rollout step.
