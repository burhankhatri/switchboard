## Purpose

Let workspace members create and improve their home page through inline AI, with live feedback and useful findings grounded in team conversations.

## ADDED Requirements

### Requirement: Home AI actions stay on home
The system SHALL open an editable, scenario-prefilled prompt popover for home Ask agent actions and summary generation. Sending SHALL start work without navigation. Every content widget, including summaries, charts and notes, SHALL expose a visible pencil opening a targeted instruction box. Editing chat-derived home content SHALL edit its presentation, not original messages.

#### Scenario: Generate a summary
- **WHEN** a member selects Ask the agent to write it, rewrites the prefilled prompt, and sends
- **THEN** generation runs on home and the saved summary appears there without reloading

#### Scenario: Targeted edit
- **WHEN** a member submits instructions from a widget's pencil
- **THEN** the operation receives that widget's current content and identity and updates that target without replacing unrelated widgets

### Requirement: AI work has live and recoverable feedback
The system SHALL show actual execution stages and affected-card activity while creating or editing, preserve existing content during edits, and display validated updates incrementally. Completion, failure, partial completion and cancellation SHALL be distinguishable. Reopening home SHALL recover operation state. Other members viewing home SHALL receive committed updates without manual refresh.

#### Scenario: Several widgets are being generated
- **WHEN** an operation saves its first valid widget while still generating another
- **THEN** the first widget appears immediately and the remaining work continues to show progress

#### Scenario: Failure or conflicting edit
- **WHEN** generation fails or the target has changed since work began
- **THEN** existing content remains intact, successful writes remain identified, and the UI offers a safe retry or regeneration without duplicate writes

### Requirement: Suggestions consider the current home
The system SHALL offer suggestions regardless of widget count, using workspace conversations and current components. Suggestions SHALL identify create versus update, explain the benefit, provide a preview and supporting evidence, and require acceptance before modifying widgets. Repeated acceptance SHALL be idempotent; stale suggestions SHALL be revalidated.

#### Scenario: Empty home
- **WHEN** a member opens suggestions with no widgets
- **THEN** useful summary and component suggestions are generated from available workspace evidence, with an honest empty state when evidence is insufficient

#### Scenario: Existing home
- **WHEN** a proposed metric is already represented
- **THEN** the system proposes a relevant update or omits the duplicate, and acceptance updates the named component live

### Requirement: Workspace AI can synthesize all workspace conversations
Home AI SHALL consider chats by any user bound to the active workspace, including unshared chats, and SHALL clearly disclose that derived findings are visible to workspace members. This derived-content policy SHALL NOT make raw private transcripts readable by other members. Retrieval, operation reads and writes SHALL enforce membership and workspace isolation. Links SHALL respect transcript visibility.

#### Scenario: Two colleagues identify an issue
- **WHEN** Wayne and Burhan discuss the same issue in separate chats within the workspace
- **THEN** AI can correlate their evidence into one attributed workspace finding without exposing an inaccessible transcript link

#### Scenario: Different workspace or revoked membership
- **WHEN** a request targets another workspace's conversations or the initiating member loses access
- **THEN** the request or subsequent protected operation is refused

### Requirement: Important findings surface proactively
The system SHALL refresh source-backed issue, decision and blocker cards after relevant conversation changes without requiring a Suggestions click. Findings SHALL carry dates, attribution, evidence references and supported status, merge duplicates, and distinguish unresolved issues from later resolutions. Unsupported ownership or resolution SHALL NOT be invented. Proactive refresh SHALL NOT silently apply proposed widget rearrangements or replacements.

#### Scenario: An issue is later resolved
- **WHEN** later conversation evidence resolves an existing issue
- **THEN** its existing finding is updated and marked resolved rather than adding another open issue

### Requirement: Home presentation is visual and accessible
The system SHALL display timelines as compact visual milestone cards with dates, icons, status labels and attribution, with optional expanded details. Initial load and AI edits SHALL have distinct loading feedback with stage text, stable layout and reduced-motion support. Colour SHALL NOT be the only status indicator.

#### Scenario: Editing a timeline on mobile
- **WHEN** AI updates a timeline while a mobile member views home
- **THEN** existing milestones remain readable, progress is visible, and updated milestones appear without navigating away or requiring horizontal page scrolling
