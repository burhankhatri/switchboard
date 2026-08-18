# workspace-files

## Purpose
Browsing and editing a workspace's files. The repo is the single source of
truth, so reads and writes go to it rather than to a sandbox.

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

### Requirement: Paths are confined to the workspace
The system SHALL reject reads and writes outside the workspace folder and the
shared root.

#### Scenario: A path belonging to another workspace
- **WHEN** a member requests a path under a different workspace
- **THEN** the request is rejected with 403, because every workspace shares one
  repo and containment is the only thing separating them

### Requirement: New folders carry a placeholder
The system SHALL create a placeholder file when a folder is created.

#### Scenario: Creating a folder
- **WHEN** a member creates a folder
- **THEN** a `.gitkeep` is committed inside it, because git cannot represent an
  empty directory
