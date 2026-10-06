## ADDED Requirements

### Requirement: Opening a file previews it by format
The system SHALL render a read-only preview for spreadsheets (xlsx, xlsm, xlsb, xls, ods, numbers, csv, tsv), PDF, images, audio, video, Word documents, PowerPoint slide text, zip listings, fonts, and rendered Markdown, HTML and SVG, for files stored in Git or in Storage. Text with a rendered form SHALL offer an Edit toggle to the existing editor. Every file SHALL offer Download.

#### Scenario: Opening a macro-enabled workbook
- **WHEN** a member opens a 3 MB `.xlsm` file stored in Git
- **THEN** its sheets are shown as tables with tabs, using cached formula values, and no text editor or Save is offered

#### Scenario: Opening a retained Storage asset
- **WHEN** a member opens a file larger than 3 MiB that is retained in Storage
- **THEN** it is previewed like a Git file, with Download still available

#### Scenario: Opening Markdown
- **WHEN** a member opens a `.md` file
- **THEN** it is shown rendered, and Edit switches to the editor where saving commits as before

#### Scenario: A file that cannot be previewed
- **WHEN** a file is corrupt, encrypted, unsupported or over 25 MiB
- **THEN** the viewer shows why and offers Download instead of a blank pane

### Requirement: Raw file bytes are served to members only, never as a page
The system SHALL serve a workspace file's bytes only to members of that workspace, for paths inside the workspace or the shared root, and SHALL mark every response as a non-renderable download.

#### Scenario: A member requests a Git file's bytes
- **WHEN** a member requests the bytes of a Git file
- **THEN** they are streamed from the workspace branch regardless of GitHub's 1 MB Contents API limit, as `application/octet-stream` with `nosniff`, an attachment disposition and a sandboxing CSP

#### Scenario: A member requests a Storage asset's bytes
- **WHEN** a member requests the bytes of a retained asset
- **THEN** they are redirected to a short-lived signed Storage URL

#### Scenario: A non-member or an outside path
- **WHEN** a caller is not a member, or names a path outside the workspace and shared root
- **THEN** the request is rejected before any bytes are read

### Requirement: Binary formats never reach the text editor
The system SHALL classify Office, OpenDocument, macro-enabled, image, audio, video, archive and font formats as binary, so they are never opened in or saved from the text editor.

#### Scenario: A small macro-enabled workbook
- **WHEN** a member opens a `.xlsm` file under 1 MB
- **THEN** it is previewed, and Save is not offered, so its bytes cannot be overwritten with decoded text
