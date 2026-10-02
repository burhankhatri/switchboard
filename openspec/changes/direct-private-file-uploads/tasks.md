## 1. Private upload infrastructure

- [x] 1.1 Add Prisma upload/asset models and an additive migration; regenerate the client.
- [x] 1.2 Implement bounded Storage requests, signed uploads/downloads, ownership/size validation, claims, release and cleanup.
- [x] 1.3 Add the authenticated upload authorization endpoint and browser direct uploader with progress and retry reuse.

## 2. Product flows

- [x] 2.1 Update chat validation and send to accept 25 MiB files through scoped upload IDs; fail attachment transfer visibly and consume after successful send.
- [x] 2.2 Update workspace imports to commit small files and retain large assets, preserving exclusions, containment and collision checks.
- [x] 2.3 Merge assets into workspace browsing with private download access and prevent editing retained assets.
- [x] 2.4 Hydrate assets before interactive and scheduled sessions with membership, path/symlink checks and Git exclusions.
- [x] 2.5 Integrate bounded expired-upload cleanup into the authenticated lifecycle cron.

## 3. Setup and verification

- [x] 3.1 Provide a private-bucket setup script and document server environment variables, deployment and free-plan quotas.
- [x] 3.2 Test upload boundaries, authorization, failed transfers/retries, imports and hydration isolation; run web typecheck and the full test suite.
