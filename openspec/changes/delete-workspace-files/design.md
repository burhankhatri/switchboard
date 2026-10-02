## Context

Workspace rows list Git files and retained private Storage assets together. Assets point to FileUpload records; the lifecycle cron removes expired unreferenced uploads. Git reads and writes share a service credential and cache. See proposal.md for motivation.

## Goals / Non-Goals

Goals: single-file deletion from the common sidebar, store-aware deletion, membership/path protection, version conflicts and cache coherence.
Non-goals: recursive folder deletion, shared-root deletion, removing historical Git blobs, and changing an already running sandbox immediately.

## Decisions

- Use the existing Files route with DELETE and path/sha JSON. Only workspace-local safe file paths are accepted. Git uses the Contents delete API with the workspace branch and expected SHA. Storage uses the upload ID as the version.
- Delete a Storage object before conditionally removing its asset reference. On Storage failure keep the reference so retry remains possible. Keep consumed FileUpload metadata for 24 hours to catch objects recreated by outstanding signed upload permissions. Conditional removal protects concurrently replaced assets.
- Use the existing Radix menu and dialog primitives. Fetch the file version when opening Delete, then show confirmation. Clear both query and local caches only on success; retain failures in the dialog for retry.

## Risks / Trade-offs

- Storage and database cannot commit atomically: database failure after object deletion can leave a broken reference; retry is safe and completes removal. A replacement retains a distinct object path and is not deleted.
- Existing sandbox copies remain until the next hydration, which already removes assets missing from the workspace manifest. In-flight transfers may fail when the shared object is deleted.

## Migration Plan

Deploy application code with the existing upload tables; no migration or bucket configuration changes. Rollback removes the UI action but cannot restore deleted Storage bytes; Git history retains Git deletions.
