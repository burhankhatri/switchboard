## ADDED Requirements

### Requirement: Retained workspace assets are available before the agent starts
The system SHALL download the active workspace's retained assets into their workspace-relative paths before both interactive and scheduled agents start, checking current membership. Downloaded assets SHALL be excluded from Git staging and SHALL NOT include another workspace's assets. A failed download SHALL fail the run visibly.

#### Scenario: First run with a retained dataset
- **WHEN** a member starts a run in a workspace with a retained large dataset
- **THEN** the agent can read that dataset at its workspace path without adding it to Git history

#### Scenario: Scheduled run
- **WHEN** an authorized scheduled job starts
- **THEN** it receives the same retained assets as an interactive run

#### Scenario: Membership revoked
- **WHEN** a user who has left the workspace attempts to hydrate its retained assets
- **THEN** hydration fails before any object is downloaded

