# agent-runs

## Purpose
Executing a workspace: a disposable sandbox, the workspace's assets, and a
headless agent started inside them.

## Requirements

### Requirement: A run fetches only its own workspace's assets
The system SHALL sparse-clone the workspace folder and the repo-root `.claude`,
and nothing else.

#### Scenario: Running one workspace among many
- **WHEN** a run starts for `workspaces/lead-gen`
- **THEN** only `workspaces/lead-gen` and `.claude` are checked out, and sibling
  workspaces are absent from the sandbox filesystem

#### Scenario: Sparse patterns are anchored
- **WHEN** sparse paths are applied
- **THEN** each is anchored to the repo root, because `--no-cone` patterns are
  gitignore-style and an unanchored `.claude` matches at any depth, pulling in
  every sibling workspace's skills

#### Scenario: Fetching blobs for newly included paths
- **WHEN** `sparse-checkout set` runs against a partial clone
- **THEN** it is given the same credentials as the clone, because materialising
  those paths is a network fetch from the promisor remote

### Requirement: The agent runs inside the workspace folder
The system SHALL set the agent's working directory to the workspace folder
within the clone.

#### Scenario: Skill discovery
- **WHEN** the agent starts with cwd at `<clone>/<workspace.path>`
- **THEN** it discovers both that workspace's `.claude/skills/` and the
  repo-root `.claude/skills/`, because discovery walks from cwd up to the repo
  root — no `--add-dir` is required

#### Scenario: Git operations
- **WHEN** the agent commits or pushes
- **THEN** git targets the clone root, which stays distinct from the agent's cwd

### Requirement: The workspace prompt cannot override platform rules
The system SHALL place a workspace's system prompt after the platform
instructions and fence it.

#### Scenario: A workspace prompt contradicts a platform rule
- **WHEN** a workspace prompt instructs the agent to ignore the git rules
- **THEN** the platform rules still precede it and the prompt is presented as
  workspace instructions that do not override them

### Requirement: Scheduled and on-demand runs share one path
The system SHALL resolve a workspace identically for both trigger types.

#### Scenario: A scheduled run
- **WHEN** the cron starts a job with a `workspaceId`
- **THEN** it resolves the workspace exactly as an interactive chat does,
  differing only in what triggered it
