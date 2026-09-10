# workspace-management

## Purpose
A workspace is a folder in one private git repo (`WORKSPACES_REPO`) carrying the
skills, scripts and connections for one kind of work. Membership is what grants
access to it.

## Requirements

### Requirement: Workspace creation writes the repo before the row
The system SHALL commit a workspace's scaffold folder to the workspaces repo
before creating its database row.

#### Scenario: Creating a workspace
- **WHEN** an authenticated user POSTs a name to `/api/workspaces`
- **THEN** the system ensures `WORKSPACES_REPO` exists, commits
  `workspaces/<slug>/workspace.yaml` and a starter
  `workspaces/<slug>/.claude/skills/<slug>-guide/SKILL.md`, and only then writes
  the `Workspace` row with the creator as an `owner` member

#### Scenario: The commit fails
- **WHEN** a GitHub write fails after retries
- **THEN** no `Workspace` row is created, so a row can never point at a folder
  that does not exist

#### Scenario: Re-scaffolding an existing folder
- **WHEN** a path already exists in the repo
- **THEN** it is left untouched, so a retried scaffold heals a partial one
  instead of clobbering it

### Requirement: Slugs are derived and path-safe
The system SHALL derive the slug from the name and reject any that would not be
safe to interpolate into a sandbox path.

#### Scenario: A name containing traversal
- **WHEN** a user submits the name `../../etc/passwd`
- **THEN** the slug becomes `etc-passwd` and the resulting path is validated by
  `isSafeWorkspacePath` before use

#### Scenario: A duplicate name
- **WHEN** a slug already exists
- **THEN** the request is rejected with 400

### Requirement: Visibility is separate from membership
The system SHALL let every signed-in user see every workspace, while reserving
access to its contents for members.

#### Scenario: Browsing to find something to join
- **WHEN** any signed-in user lists `/api/workspaces`
- **THEN** all non-archived workspaces are returned with a `joined` flag

#### Scenario: A non-member reads workspace contents
- **WHEN** a non-member requests connection names or files
- **THEN** the request is rejected with 403

### Requirement: The last owner cannot leave
The system SHALL refuse to remove the final owner of a workspace.

#### Scenario: Sole owner leaves
- **WHEN** the only `owner` DELETEs their membership
- **THEN** the request is rejected with 400, because a shared workspace nobody
  can administer is a failure that would surface much later

### Requirement: An invited GitHub handle joins on first sign-in
The system SHALL let an owner add someone who has no account yet, by GitHub
handle, and SHALL convert that invite into membership on that person's next
sign-in.

Membership needs a `User` row to point at, so this used to be refused outright
and onboarding stalled on the one person who was not there to be chased.
Nothing is emailed: a GitHub handle does not yield an address, and the claim
does not need one.

#### Scenario: Adding a handle with no account behind it
- **WHEN** an owner POSTs an unrecognised GitHub handle to
  `/api/workspaces/<id>/members`
- **THEN** a `WorkspaceInvite` row is written against the lowercased handle and
  the response reports `invited: true`

#### Scenario: The invited person signs in for the first time
- **WHEN** they complete GitHub OAuth under that handle, in any casing
- **THEN** the sign-in event creates their `WorkspaceMember` row with the
  invited role and deletes the invite, so the workspace is already there when
  they arrive

#### Scenario: An identifier that is not a handle
- **WHEN** the unrecognised identifier is an email address or a display name
- **THEN** the request is rejected with 400, because GitHub reports a login at
  sign-in and an invite held against anything else could never be claimed

#### Scenario: A claimed invite is not reusable
- **WHEN** an invite has been claimed and the member is later removed
- **THEN** they are not re-added on their next sign-in, because claiming
  deletes the invite rather than flagging it

#### Scenario: An invite does not widen who may sign in
- **WHEN** `ALLOWED_GITHUB_LOGINS` is set and does not list the invited handle
- **THEN** sign-in is still refused and no invite is claimed, because a
  workspace owner must not be able to admit users to the deployment

#### Scenario: Withdrawing an unclaimed invite
- **WHEN** an owner DELETEs `/api/workspaces/<id>/invites/<handle>`
- **THEN** the invite is removed, so a mistyped handle is not a standing grant
  of the workspace's credentials
