## MODIFIED Requirements

### Requirement: Files are read from the repo, not a sandbox
The system SHALL serve small workspace files from the workspaces repo and retained large workspace assets from private Storage, without requiring a sandbox.

#### Scenario: Browsing before any run exists
- **WHEN** a member opens a workspace that has never been run
- **THEN** Git files and retained Storage assets are listed together without creating a sandbox

#### Scenario: Opening a retained asset
- **WHEN** a member opens a retained large file
- **THEN** it can be downloaded privately and is not presented as an editable Git file

### Requirement: Every upload goes through the import
The system SHALL finalize picked and dropped files and folders through the import route using private upload references, preserving bytes and relative paths. Files up to 3 MiB SHALL be committed to Git; larger files SHALL be retained in private Storage. The system SHALL reject an upload that would replace an existing file in the other storage type.

#### Scenario: Uploading a PDF or an image
- **WHEN** a member uploads a binary file
- **THEN** its bytes are preserved in Git or Storage according to its size

#### Scenario: Dropping a folder
- **WHEN** a member drops a folder
- **THEN** its directory structure is preserved, including folders with more entries than one browser directory read returns

#### Scenario: Dropping onto a folder in the tree
- **WHEN** a member drops files onto a folder row
- **THEN** they land inside that folder and it opens to show them

#### Scenario: Replacing a Git file with a large asset
- **WHEN** an import would replace an existing Git file with a Storage asset, or the reverse
- **THEN** it fails visibly before transferring files, avoiding two different sources at the same path

### Requirement: Uploads are capped by what one request carries
The system SHALL accept files up to 25 MiB through direct private uploads, cap one import at 100 MiB and 200 files, and send only metadata through the application's import request.

#### Scenario: A file over the old 256KB cap
- **WHEN** a member uploads a 1 MiB lead list
- **THEN** it is accepted and committed to Git

#### Scenario: A file too big for one request
- **WHEN** a member uploads a file larger than 3 MiB and no larger than 25 MiB
- **THEN** it is accepted into private Storage without sending file bytes through Vercel

### Requirement: A folder is imported as one commit
The system SHALL commit the Git-backed files in an imported folder together while retaining larger files in Storage. A retained large asset SHALL NOT add its bytes to Git history.

#### Scenario: Importing a folder of many files
- **WHEN** a member imports a mixed folder
- **THEN** its small files are committed together and its larger assets retain their paths in the workspace file tree

#### Scenario: Someone pushes while the import is uploading
- **WHEN** the branch moves after Git blobs are written but before its ref update
- **THEN** the import fails without forcing the branch or reporting the failed commit as successful

