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

### Requirement: A finished turn is never a blank reply
When a turn ends with no text from the model, the system SHALL write the reason
into the assistant message itself and flag the message as an error, so the
reason survives a reload and is not only in the live banner or the activity log.

#### Scenario: The provider rejects the run before the first token
- **WHEN** a turn ends in error with empty content
- **THEN** the persisted assistant message reads `Agent stopped: <reason>`, is
  flagged `isError`, and names the fix where one is known (the free-tier version
  gate points at the model menu and an image rebuild)

#### Scenario: The model says nothing and does nothing
- **WHEN** a turn completes with no text and no tool calls
- **THEN** the message says so and is flagged `isError`, rather than persisting
  as an empty string

#### Scenario: A quiet tool-only turn
- **WHEN** a turn completes with tool calls but no prose
- **THEN** the message is left as the agent produced it; it is not an error

#### Scenario: Partial output before the failure
- **WHEN** a turn ends in error after the model had written some text
- **THEN** that text is kept and the stop line is appended below it

### Requirement: External writes are receipted
Every tool call that changes something outside the sandbox (an HTTP POST, PUT,
PATCH or DELETE to a workspace API, a script run with `--apply`, a script that
writes by default) SHALL be tagged when the agent's events are parsed, listed
under the assistant message as "Writes this turn" with what the response
reported, and recorded once per turn as an `external_write` event in the
workspace feed. Reads, including Instantly's POST-shaped list endpoints, are
not tagged.

#### Scenario: A push through a script
- **WHEN** a turn runs `python3 scripts/push_to_instantly.py --campaign <id> --apply`
- **THEN** the message shows `apply push_to_instantly.py --campaign <id>` with the
  count the script reported, and the feed shows the same line attributed to the
  person whose chat it was

#### Scenario: A read-only turn
- **WHEN** a turn only ran `GET` requests and dry runs
- **THEN** nothing is listed and no feed event is written

#### Scenario: A write before a crash
- **WHEN** a turn makes a write and then ends in error
- **THEN** the write is still receipted; the error does not hide it

#### Scenario: A driver script written and run in the same turn
- **WHEN** the agent writes a script to a file (a heredoc or the Write tool)
  whose source posts to an API, then runs it in a later call of the same turn
- **THEN** the run is receipted as `run <script> (<verb> <path>)`

#### Scenario: Chained shell commands
- **WHEN** one command chains several curl calls
- **THEN** each call's verb is paired only with its own URL, so a POST-shaped
  list read followed by a GET is not a write

### Requirement: Documentation-only commits land on the base branch
After a successful auto-push of an agent branch in a workspace, the system SHALL
merge that branch into the workspace's base branch through the GitHub API when
every change since the merge base is under the workspace folder and matches
`campaigns/**`, `LEARNINGS.md`, `HOME.md` or `.claude/skills/**/reference/**`.
Any other change, including a `SKILL.md`, a script, a test or `workspace.yaml`,
leaves the branch for a person to merge. A merge is recorded as a
`branch_merged` feed event; a refusal is logged and is not an error.

#### Scenario: A campaign spec and a LEARNINGS entry
- **WHEN** an agent commits `campaigns/<slug>/campaign.json` and `LEARNINGS.md`
  and the push succeeds
- **THEN** the branch is merged into the base branch and the next chat's fresh
  clone contains both files

#### Scenario: A script changed alongside the docs
- **WHEN** the same commit also touches `scripts/push_to_instantly.py`
- **THEN** nothing is merged and the branch waits for review

#### Scenario: GitHub reports a conflict
- **WHEN** the merges API answers 409
- **THEN** the push is still reported as a success and the branch is left as it is

### Requirement: A write needs a click
An interactive run SHALL be offered a `request_approval` tool on the run-scoped
MCP endpoint. Calling it records a pending approval on the chat (action, count,
campaign), parks the chat as awaiting input and notifies the owner; the agent is
told to end the turn. The owner approves or declines from the chat. The next
turn on that chat receives the oldest approved, unspent approval's id as
`SWITCHBOARD_APPROVAL` in the agent's environment and marks it used. The
variable is set by the platform only; user and workspace variables cannot
supply it. Scheduled runs are not offered the tool. The workspace scripts that
write (`push_to_instantly.py --apply`, `create_campaign.py --apply`) refuse
without the variable.

#### Scenario: The agent wants to push
- **WHEN** the agent calls `request_approval` with "add leads to campaign", 16
  and a campaign, then ends the turn
- **THEN** the chat shows an Approve button with that line, and
  `push_to_instantly.py --apply` run in that same turn exits non-zero naming the
  tool

#### Scenario: The owner approves
- **WHEN** the owner clicks Approve and sends the next message
- **THEN** that turn's environment carries `SWITCHBOARD_APPROVAL` once, the
  approval is marked used, and a later turn does not receive it again

#### Scenario: A double click
- **WHEN** a decision is posted for an approval that is no longer pending
- **THEN** the request is refused with 400 and nothing changes

#### Scenario: An agent that keeps asking
- **WHEN** three requests are already pending on the chat
- **THEN** a fourth is refused and the agent is told to stop
