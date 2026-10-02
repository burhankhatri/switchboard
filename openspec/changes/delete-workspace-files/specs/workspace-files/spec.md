## ADDED Requirements

### Requirement: Members can delete workspace files from the sidebar
The system SHALL offer a right-click Delete action on workspace file rows, confirm before deletion, and remove the file from its backing store. Shared root files and folders SHALL NOT be deletable through this action. Deletion SHALL require current workspace membership, a confined safe path and the expected file version.

#### Scenario: Delete a Storage asset
- **WHEN** a member confirms deletion of a Storage file
- **THEN** its private Supabase object and workspace asset reference are removed, the tree refreshes and the file is absent from future hydrated runs

#### Scenario: Delete a Git file
- **WHEN** a member confirms deletion of a Git file
- **THEN** an attributed deletion commit is made on the workspace branch and files and skills refresh

#### Scenario: Cancel or backend failure
- **WHEN** a member cancels, or the backing store fails to delete the file
- **THEN** the file stays listed and failures are displayed with a retry option

#### Scenario: Unauthorized or unsafe deletion
- **WHEN** a caller lacks membership or names another workspace, shared root, a directory or a traversal path
- **THEN** deletion is refused before changing either backing store

#### Scenario: Concurrent replacement
- **WHEN** a file version changes after the delete action is opened
- **THEN** deletion is rejected as a conflict and the newer file remains

#### Scenario: Delete the open file
- **WHEN** the deleted file is open in the viewer
- **THEN** its viewer closes and cached contents and drafts are cleared after successful deletion
