## Purpose

Let authenticated users transfer private files without passing their bytes through the application's serverless request boundary, while preserving access control and bounded resource use.

## ADDED Requirements

### Requirement: Direct uploads are private and scoped
The system SHALL authorize uploads only for the signed-in chat owner or a current workspace member, bind each upload to its uploader and destination, and never expose a server credential. Finalization SHALL recheck access and reject another user's upload, a different destination, or an expired upload.

#### Scenario: Uploading an attachment
- **WHEN** an authorized user selects a file
- **THEN** the browser receives temporary permission for one private object and transfers bytes directly to Storage

#### Scenario: Reusing someone else's upload ID
- **WHEN** a request names an upload created by another user or for another scope
- **THEN** it is rejected before the object is read or transferred

### Requirement: Files are limited to 25 MiB
The system SHALL accept a file up to and including 25 MiB, reject larger files before upload and after inspecting the actual object, and enforce a 100 MiB aggregate budget per chat message or workspace import. Existing count caps SHALL remain 20 chat attachments and 200 workspace files.

#### Scenario: Exact limit
- **WHEN** a user uploads a file of exactly 25 MiB
- **THEN** it is accepted, including when it exceeds the serverless request limit

#### Scenario: A false size declaration
- **WHEN** an uploaded object exceeds its declared size or the file cap
- **THEN** finalization fails and does not start an agent with that file

### Requirement: Failed transfers are retryable and abandoned files are cleaned
The system SHALL keep an unconsumed temporary upload available for retry until expiry, remove successfully consumed temporary objects, and clean expired unretained objects without deleting retained workspace assets. Failed attachment transfer SHALL prevent the agent from running without the selected files.

#### Scenario: Transfer fails
- **WHEN** transferring a staged chat attachment to Daytona fails
- **THEN** the message fails visibly and its staged object remains available for retry

#### Scenario: Abandoned upload
- **WHEN** an unretained upload expires after 24 hours
- **THEN** cleanup removes its private object and upload record

