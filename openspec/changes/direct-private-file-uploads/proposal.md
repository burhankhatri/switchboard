## Why

Uploads currently pass through Vercel Functions and are limited to 3 MB per workspace file and 4 MB per chat message. Private direct-to-Storage uploads let members use files up to 25 MiB without growing Git history with large binary assets.

## What Changes

- Authorize direct uploads to private Supabase Storage using short-lived signed upload URLs and server-owned upload records.
- Accept up to 25 MiB per file, with bounded aggregate sizes and existing file-count limits.
- Keep workspace files up to 3 MiB in Git; retain larger workspace assets in Storage and list them alongside Git files.
- Download retained assets into the workspace before interactive and scheduled runs, excluding them from Git commits.
- Transfer chat attachments from Storage to Daytona and remove temporary copies after successful consumption. Fail the send if attachment transfer fails.
- Clean abandoned uploads and provide setup instructions for Supabase Free.

## Capabilities

### New Capabilities
- `file-uploads`: Private direct uploads, scope and ownership checks, size validation, retries and cleanup.

### Modified Capabilities
- `workspace-files`: Import and browse files from Git and private Storage; increase the per-file cap to 25 MiB.
- `agent-runs`: Hydrate retained workspace assets before the agent starts without committing them to Git.

## Impact

Prisma upload and workspace-asset records and migration; Storage REST integration; chat composer and send endpoint; workspace import, listing and viewing; interactive and scheduled startup; lifecycle cleanup; environment documentation. Supabase project URL and a server-only service-role key are required. No Supabase Auth migration or paid plan is needed.
