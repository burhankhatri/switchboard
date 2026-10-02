## Why

Members can upload workspace files but cannot remove them from the sidebar. Large files must also be removed from private Storage when deleted to reclaim space.

## What Changes

- Add a right-click Delete action for workspace file rows with confirmation and visible failures.
- Delete Git files through an attributed commit and Storage assets through object deletion plus metadata removal.
- Enforce membership, workspace path containment and version checks; refresh files and skills and close the deleted file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-files`: Confirmed file deletion from the sidebar and the relevant backing store.

## Impact

Workspace Files API, GitHub repo helper, private Storage metadata, file tree, browser caches and tests. No new dependencies or database migration.
