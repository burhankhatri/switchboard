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

#### Scenario: A chat outside the workspaces repo
- **WHEN** a chat has no workspace, or its repo is not its workspace's repo
- **THEN** the repo is cloned in full, because there is no workspace folder in
  it to narrow to

#### Scenario: Sparse patterns are anchored
- **WHEN** sparse paths are applied
- **THEN** each is anchored to the repo root, because `--no-cone` patterns are
  gitignore-style and an unanchored `.claude` matches at any depth, pulling in
  every sibling workspace's skills

#### Scenario: Fetching blobs for newly included paths
- **WHEN** `sparse-checkout set` runs against a partial clone
- **THEN** it is given the same credentials as the clone, because materialising
  those paths is a network fetch from the promisor remote

### Requirement: A workspace run's git access follows membership
The system SHALL perform git and GitHub operations on the workspaces repo with
the shared service credential for members — runs when the user is a member of
the run's workspace, manual branch actions when the user is a member of any
workspace in the repo — and SHALL use the user's own GitHub token for every
other repo.

#### Scenario: A member who is not a GitHub collaborator runs a workspace
- **WHEN** a member without access to the private workspaces repo sends a
  message in a workspace chat, or their scheduled workspace job fires
- **THEN** the clone, pre-run pull, auto-push and scheduled-job PR use the
  service credential — otherwise GitHub answers the clone with "Repository not
  found"

#### Scenario: A chat that only names the workspaces repo
- **WHEN** a chat's repo is the workspaces repo but its user is not a member of
  its workspace (or it has none)
- **THEN** the user's own token is used, because the service credential can
  read every workspace's folder and naming the repo must not grant that

#### Scenario: Manual branch actions
- **WHEN** a member lists branches, compares, merges, rebases, squashes,
  force-pushes, deletes a branch or opens a PR by hand on the workspaces repo
- **THEN** those routes use the service credential too, gated on membership of
  any workspace in that repo — otherwise every one of them fails with a GitHub
  404. Any member can therefore merge into the shared base branch; members are
  one team, so review is a matter of process rather than enforced here

#### Scenario: Commit authorship
- **WHEN** a workspace run clones with the service credential
- **THEN** the sandbox's git identity is still looked up with the member's own
  token, so commits are authored as the member rather than the service account

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

#### Scenario: A scheduled run needs the workspace's credentials
- **WHEN** a scheduled job bound to a workspace starts
- **THEN** that workspace's variables and REST connections are injected into
  the run, last, exactly as for an interactive turn - otherwise a job would
  start with the workspace's cwd and skills but no key to call the API those
  skills describe

#### Scenario: The run belongs to the workspace
- **WHEN** a scheduled run creates its chat
- **THEN** that chat carries the job's `workspaceId`, so the run appears under
  the workspace it ran in

### Requirement: Membership is checked when a job is bound and again when it runs
The system SHALL require workspace membership both to bind a scheduled job to a
workspace and to execute one.

#### Scenario: Binding a job
- **WHEN** a user creates or updates a scheduled job naming a workspace
- **THEN** membership is required, because the binding is what causes that
  workspace's decrypted connections to reach a sandbox

#### Scenario: The author leaves the workspace
- **WHEN** a job's owner is removed from the workspace and the job next fires
- **THEN** the run fails rather than proceeding, because a job outlives the
  membership that created it and a bind-time check alone would revoke nothing

#### Scenario: A workspace supplies the job's repo
- **WHEN** a job is created inside a workspace with no repo of its own given
- **THEN** repo, branch and agent are denormalised from the workspace, so the
  run clones what the job was written against rather than taking the
  repo-less path and starting with no skills or scripts
