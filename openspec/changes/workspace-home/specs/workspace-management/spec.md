## ADDED Requirements

### Requirement: Chats are private unless shared to the workspace
The system SHALL keep a chat visible only to its owner unless the owner shares
it to the workspace it runs in. A shared chat SHALL be readable, not writable,
by every member of that workspace, and the owner SHALL be able to stop sharing
it at any time.

#### Scenario: Sharing a chat
- **WHEN** a chat's owner shares it to its workspace
- **THEN** members can open it read-only from the home page and the activity
  feed, and the feed records that it was shared

#### Scenario: A member tries to send a message in someone else's shared chat
- **WHEN** a member who does not own a shared chat sends a message to it
- **THEN** the request is rejected, because a chat's runs are attributed to its
  owner

#### Scenario: Unsharing
- **WHEN** the owner stops sharing a chat
- **THEN** members can no longer open it, and feed events that referenced it no
  longer link to it

#### Scenario: Leaving the workspace
- **WHEN** a member leaves or is removed from a workspace
- **THEN** they can no longer read chats shared to it

#### Scenario: A chat outside any workspace
- **WHEN** a chat has no workspace
- **THEN** it cannot be shared to one

### Requirement: Workspace activity is member-only
The system SHALL serve a workspace's jobs list, activity events, widgets and
shared chats only to its members, and SHALL check membership on every request
rather than relying on what a client was previously shown.

#### Scenario: A removed member's open tab
- **WHEN** a member is removed while their browser still shows the workspace's
  home page
- **THEN** their next request for home data, events, widgets or a shared chat is
  rejected with 403

#### Scenario: Job prompts and errors
- **WHEN** a member views a job someone else created
- **THEN** the job's prompt and its runs' error text are shown, because they are
  already readable by every member through the runs list, and are never shown
  to a non-member
