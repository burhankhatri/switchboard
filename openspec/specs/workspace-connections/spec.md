# workspace-connections

## Purpose
A workspace declares the API connections it needs (for example `CRM_KEY`). The
platform holds the values; a run receives them without anyone replicating a
setup. This is the security-critical path.

## Requirements

### Requirement: Connection values never leave the server
The system SHALL NOT return a connection value from any endpoint.

#### Scenario: Reading connections
- **WHEN** a member GETs `/api/workspaces/:id/env`
- **THEN** only key names are returned

#### Scenario: Writing connections
- **WHEN** an owner PUTs new values
- **THEN** the response contains only key names, and the audit row records names
  only

### Requirement: Writes are owner-only, reads are member-only
The system SHALL restrict connection writes to owners and name reads to members.

#### Scenario: A plain member attempts a write
- **WHEN** a non-owner member PUTs `/api/workspaces/:id/env`
- **THEN** the request is rejected with 403

#### Scenario: A non-member attempts a read
- **WHEN** a non-member GETs the key names
- **THEN** the request is rejected with 403

### Requirement: Injection requires membership at bind time and at run time
The system SHALL verify workspace membership both when a chat is bound to a
workspace and on every subsequent run.

#### Scenario: Binding a chat
- **WHEN** a user POSTs `/api/chats` with a `workspaceId` they are not a member of
- **THEN** the request is rejected with 403, because binding is what causes
  secrets to be injected

#### Scenario: A former member runs an existing chat
- **WHEN** a user runs a chat whose workspace they have since left
- **THEN** the turn fails and no connections are injected, because a chat keeps
  its `workspaceId` for life and would otherwise still receive a rotated key

### Requirement: Workspace connections outrank user variables
The system SHALL merge workspace connections after all user-supplied variables.

#### Scenario: A user sets a variable with the same name
- **WHEN** a chat-level variable shares a name with a workspace connection
- **THEN** the workspace value wins and the attempt is logged, so a member
  cannot point a shared workspace at a system of record of their choosing

#### Scenario: A user overrides a platform default
- **WHEN** a chat-level variable shares a name with a system variable
- **THEN** the user value wins, because only workspace connections are protected

### Requirement: A value that cannot be decrypted fails the run
The system SHALL fail loudly rather than injecting an unverified value.

#### Scenario: Wrong encryption key
- **WHEN** a stored value does not decrypt to the expected marker
- **THEN** the run fails with an error naming the workspace and key

#### Scenario: Wrong key that unpads to valid text
- **WHEN** a wrong key yields non-empty valid UTF-8 by chance
- **THEN** it is still rejected, because AES-CBC without a MAC cannot
  authenticate ciphertext and "non-empty UTF-8" is not an integrity check
