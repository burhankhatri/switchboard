# Private file uploads

Files up to **25 MiB each** upload directly from the browser to a private Supabase Storage bucket. Each chat message or workspace import is limited to **100 MiB total**, with at most 20 chat files or 200 workspace files. This bypasses Vercel's request-body ceiling and works on Supabase Free.

Workspace files up to 3 MiB remain in Git. Larger files stay in Storage, appear in the same file tree, and download into their workspace-relative paths before an interactive or scheduled agent starts. They are excluded from Git staging. Edits made to these assets during a run remain local to that sandbox; upload a replacement to change the shared asset. Replacing a Git file with a Storage asset or the reverse at the same path is rejected; use a different name.

Chat attachments are copied into Daytona and their temporary Storage copies deleted after the send succeeds. Failed transfers fail the send visibly and keep the staged objects for retry. Abandoned uploads expire after 24 hours and are removed in bounded batches by the existing lifecycle cron. Consumed metadata remains until expiry to catch objects recreated with a still-valid signed upload token. Retained workspace assets do not expire.

Right-click a workspace file in the sidebar and choose **Delete**, then confirm. Storage files are removed from the private bucket and workspace listing; Git files are removed through a commit on the workspace branch. Failures stay visible for retry, and concurrent replacements are protected by a version check. Shared root files and folders have no Delete action. Existing sandbox copies disappear at the next hydration; a running agent may still have its local copy.

## Setup

1. In Supabase, find the **Project URL** and the **legacy service_role key** under the project's API settings. The service-role key is different from the database password. Supabase Auth and the Data API are not needed for these Storage requests.
2. Set these server variables in `packages/web/.env.local` and in the matching Vercel environments:

   ```dotenv
   SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVER_ONLY_SERVICE_ROLE_KEY"
   SUPABASE_UPLOAD_BUCKET="switchboard-files"
   ```

   Never prefix the service-role key with `NEXT_PUBLIC_` or place it in browser code.

3. From the repo root, create or validate the private bucket:

   ```powershell
   node scripts/setup-upload-storage.mjs
   ```

   The script sets a 26,214,400-byte bucket file limit and refuses to repurpose a public bucket. The Supabase global file limit must also be at least that large. No public bucket or anonymous Storage policies are required; the app issues signed permissions after checking NextAuth identity and membership.

4. Apply the additive database migration:

   ```powershell
   npx dotenv -e packages/web/.env.local --override -- npm exec -w @switchboard/web -- prisma migrate deploy
   ```

   Deployment prebuild also applies migrations through `DIRECT_URL`.

5. Set a strong `CRON_SECRET` in Vercel if it is not already configured. Cleanup only runs on authenticated lifecycle requests. The existing lifecycle schedule must remain enabled; ensure its frequency is supported by your Vercel plan. For local/manual cleanup, call that route with `Authorization: Bearer YOUR_CRON_SECRET`.
6. Redeploy and verify a >4.5 MB chat attachment and a >3 MB workspace file. Check that the workspace asset appears in the file tree and is present in the next interactive and scheduled sandbox, with no Git commit containing its bytes.

## Free-plan resources

Supabase Free currently includes 1 GB of object storage and 5 GB of uncached egress. Retained assets use storage; transfers into Daytona and member downloads use egress. Temporary copies are deleted, but their upload/download bandwidth still counts. See [Supabase pricing](https://supabase.com/pricing) and [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits). No Pro subscription is required for this flow.

## Rollback

Existing Git files are unchanged. Keep the new tables and private objects if rolling back application code, since retained assets are referenced by database records and older code will not list them. Do not delete the bucket or metadata as part of a code rollback.
