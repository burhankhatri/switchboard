## Context

See proposal.md for motivation. NextAuth handles identity; Prisma and the existing workspace membership table authorize access. Supabase is used as Postgres, but no Storage integration exists. Vercel has a 4.5 MB request-body ceiling. Workspace imports use Git Blobs; runs sparse-clone a shared private repo.

## Goals / Non-Goals

Goals: enforce 25 MiB per-file limits on actual bytes, private scoped uploads, bounded sequential transfers, retained workspace assets and failure visibility. Non-goals: migrate identity to Supabase Auth, implement Git LFS, or turn retained assets into editable Git documents.

## Decisions

- Use the Supabase Storage REST API with a server-only service-role key. A private bucket has a 25 MiB limit. Browser PUTs use signed object URLs; server requests return only upload IDs and temporary permission.
- Store FileUpload metadata with uploader, scope type/id, original name, declared size, random object path, expiry and processing lease. WorkspaceAsset records uniquely bind a workspace-relative path to a retained upload. No user-supplied URL is fetched.
- Small files (<=3 MiB) remain in Git; larger files are retained, with path collisions across backing stores rejected. This preserves normal skills/scripts and prevents large binary histories. Bound each import/message to 100 MiB, with existing counts.
- Claim uploads atomically before finalization. Check remote object size before download and bound streamed bytes. Release claims on failure. Retained upload records have no expiry; consumed temporary objects become eligible for cleanup. Signed permissions expire after two hours; staged records expire after 24 hours.
- On chat retry, reuse staged upload IDs for the same File objects while still valid. Do not swallow attachment-transfer failures. Transfer files sequentially to bound memory and preserve the original filename safely.
- Workspace listing merges Git and retained assets. Opening an asset returns a temporary signed download URL, avoiding Vercel response-size limits. PUT refuses retained assets.
- Hydrate workspace assets in the common session creation path with workspace ID and user ID supplied by both interactive and scheduled entry points. Maintain literal paths in .git/info/exclude and a sandbox-side hydration manifest; avoid traversal and symlinks, and do not overwrite an existing tracked Git file. Exclusion prevents incidental auto-commit.
- Cleanup runs within the existing authenticated lifecycle cron, in bounded batches. Keep tombstones until signed upload permissions expire so late browser uploads cannot escape cleanup. A setup script creates or validates the private bucket without printing credentials.

## Risks / Trade-offs

- Free storage and egress are finite -> retain assets only when needed, delete temporary files, document quotas.
- Downloads and Git requests can take time -> sequential transfers, 300-second route durations and aggregate caps.
- Storage and Git/DB cannot share a transaction -> claim uploads, validate collisions before writes, report failures and keep unconsumed objects for retry.
- Agent modifications to hydrated files are local -> state this behavior in the download-only workspace asset UI; replacing retained assets requires a new upload.

## Migration Plan

Apply the additive Prisma migration, create a private bucket with a 25 MiB file limit, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server, then deploy. Existing Git files are unchanged. Rolling back code leaves retained objects/records intact but temporarily hides them; do not remove their metadata during rollback.
