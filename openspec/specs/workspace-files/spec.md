# workspace-files

## Purpose
Browsing and editing a workspace's files. The repo is the single source of
truth, so reads and writes go to it rather than to a sandbox.

The tree is a secondary view, reached from a collapsed disclosure — see
`workspace-skills` for what a workspace leads with.

## Requirements

### Requirement: Files are read from the repo, not a sandbox
The system SHALL serve workspace files from the workspaces repo.

#### Scenario: Browsing before any run exists
- **WHEN** a member opens a workspace that has never been run
- **THEN** its files are listed, because the repo is authoritative and no
  sandbox is required

### Requirement: Saving commits to the repo
The system SHALL persist an edit as a commit rather than to any other store.

#### Scenario: Saving a skill
- **WHEN** a member saves an edited file
- **THEN** it is committed to the workspaces repo with the editor named in the
  commit, so an edit and what the next run clones cannot diverge

#### Scenario: Concurrent edits
- **WHEN** the file changed after the editor opened it
- **THEN** the save is rejected as a conflict rather than overwriting the other
  person, checked via the blob SHA the editor started from

### Requirement: Repo access follows membership, not GitHub collaborators
The system SHALL authenticate workspaces-repo reads and writes with a shared
service credential when one is configured, so a member's own GitHub push access
to the private repo is not required. Server-side membership and path-containment
checks remain the access boundary. Runs follow the same rule; see agent-runs.

#### Scenario: A member without push access saves a file
- **WHEN** a member who is not a GitHub collaborator on the workspaces repo saves
  a file
- **THEN** the commit still succeeds under the service credential, because
  membership is a database row rather than a collaborator invite — otherwise the
  write would fail with a GitHub 404

### Requirement: Paths are confined to the workspace
The system SHALL reject reads and writes outside the workspace folder and the
shared root.

#### Scenario: A path belonging to another workspace
- **WHEN** a member requests a path under a different workspace
- **THEN** the request is rejected with 403, because every workspace shares one
  repo and containment is the only thing separating them

### Requirement: Skills are a top-level folder in the file tree
The system SHALL show the workspace's `.claude/skills` as a Skills folder at the
top of the file tree, open by default, and leave anything else in `.claude`
where it is.

#### Scenario: Browsing a workspace's files
- **WHEN** a member opens the Files panel
- **THEN** every skill is listed under Skills without expanding anything, because
  `.claude/skills` is the one path the agent reads skills from, and as a dotfolder
  two levels down it was invisible to anyone browsing the way Finder does

#### Scenario: Dropping a folder onto Skills
- **WHEN** a member drops a skill folder onto the Skills folder
- **THEN** it is committed under `.claude/skills`, where the agent discovers it

### Requirement: Files are listed only when asked for
The system SHALL NOT list a workspace's files until the member opens the Files
panel.

#### Scenario: Opening a workspace
- **WHEN** a member opens a workspace
- **THEN** no file listing is requested, because the listing is a GitHub round
  trip and most people open a workspace for its chats and skills

#### Scenario: Dropping files onto the Files panel
- **WHEN** a member drops files onto the Files panel
- **THEN** they are committed, with upload progress and any per-file failure
  shown in that panel

### Requirement: New folders carry a placeholder
The system SHALL create a placeholder file when a folder is created.

#### Scenario: Creating a folder
- **WHEN** a member creates a folder
- **THEN** a `.gitkeep` is committed inside it, because git cannot represent an
  empty directory

### Requirement: Every upload goes through the import
The system SHALL send picked files, a picked folder, and files or folders
dropped onto the Files panel through the import route, byte for byte.

#### Scenario: Uploading a PDF or an image
- **WHEN** a member uploads a binary file
- **THEN** it is committed unchanged, because the import carries base64 and the
  editor's text route would have turned it into replacement characters

#### Scenario: Dropping a folder
- **WHEN** a member drops a folder onto the Files panel
- **THEN** its files are uploaded with their structure, the same as a picked
  folder — including folders with more entries than the browser hands over in
  one read

#### Scenario: Dropping onto a folder in the tree
- **WHEN** a member drops files onto a folder row
- **THEN** they land inside that folder, and the folder opens to show them

### Requirement: Uploads are capped by what one request carries
The system SHALL accept a file of up to 3 MB, split an upload larger than one
request into request-sized batches, and cap one upload at 25 MB in total.

#### Scenario: A file over the old 256KB cap
- **WHEN** a member uploads a 1 MB lead list
- **THEN** it is accepted, because 256KB was a policy guess and the real ceiling
  is the ~4.5MB request body a serverless function accepts, which base64 brings
  to about 3 MB of file

#### Scenario: A file too big for one request
- **WHEN** a member uploads a file over 3 MB
- **THEN** it is named as skipped with the limit in the reason, and nothing is
  sent for it

### Requirement: A folder is imported as one commit
The system SHALL commit an imported folder as a single commit that preserves
the folder's structure, rather than one commit per file, as long as it fits in
one request; a larger upload is one commit per request-sized batch.

#### Scenario: Importing a folder of many files
- **WHEN** a member imports a folder
- **THEN** its files are committed together in one commit at paths mirroring the
  folder, because the per-file route is one commit each — fifty files would be
  fifty commits contending for the same branch, and the second concurrent one
  is rejected with a 409

#### Scenario: Someone pushes while the import is uploading
- **WHEN** the branch moves after the import's blobs are written but before its
  ref update
- **THEN** the import fails and says so, because the alternative is a forced
  update that discards the other person's commit

### Requirement: An import excludes what it must not commit
The system SHALL exclude version-control directories, dependency directories,
editor and OS artefacts, and files that look like secrets from an import, and
SHALL report every exclusion rather than dropping it silently.

#### Scenario: A folder containing .git and .env
- **WHEN** a member imports a project folder
- **THEN** `.git`, `node_modules` and `.env` are left out while `.env.example`
  is kept, because a folder pick sweeps in whatever is on disk and a commit to a
  shared repo is permanent

#### Scenario: A file the caps reject
- **WHEN** a file exceeds the per-file cap, or the folder exceeds the total size
  or file-count caps
- **THEN** it is reported as skipped with the reason, so the result reads as
  "committed 12, skipped 4" rather than as files silently vanishing

#### Scenario: A path that would escape the workspace
- **WHEN** an import entry names a path outside the workspace folder
- **THEN** the import is refused before anything is written, because the request
  body is hand-editable and containment is all that separates workspaces in one
  repo
