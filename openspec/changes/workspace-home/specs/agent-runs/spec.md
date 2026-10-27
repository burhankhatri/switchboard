## ADDED Requirements

### Requirement: An agent can pin and refresh home widgets
The system SHALL offer the agent in a workspace run two tools on the run-scoped
MCP endpoint: one that creates a home widget, and one that replaces the content
of a widget the agent names. Both SHALL act in the run's workspace only, as the
run's attributed user, and SHALL apply the same type schemas and size limits as
widgets created by a person. A created widget SHALL appear on home immediately,
without approval.

#### Scenario: Creating a widget in a chat
- **WHEN** a member asks the agent to add a chart of weekly leads to the home
  page
- **THEN** the agent creates a chart widget, the tool returns the widget's id
  and the agent can tell the member it is on the home page

#### Scenario: A run without a workspace
- **WHEN** a run that is not bound to a workspace calls either tool
- **THEN** the tool fails with a reason the agent can read, and nothing is
  written

#### Scenario: Updating a widget in another workspace
- **WHEN** an agent names a widget id that belongs to a different workspace
- **THEN** the update is refused exactly as if the widget did not exist

#### Scenario: The run's user is no longer a member
- **WHEN** either tool is called by a run whose attributed user has since left
  the workspace
- **THEN** the call is refused, because membership is checked at call time, not
  only when the run started

#### Scenario: Too many widgets
- **WHEN** an agent tries to create a widget in a workspace that already has 40
- **THEN** the tool fails telling the agent to update an existing widget instead

### Requirement: Scheduled runs receive the run-scoped MCP endpoint
The system SHALL give a scheduled run in a workspace the same run-scoped MCP
endpoint, and a run token attributing it to the job and its author, as an
interactive chat receives.

#### Scenario: A job that refreshes a widget
- **WHEN** a job's prompt asks the agent to update a home widget with this
  week's figures and the job fires
- **THEN** the agent can call the widget update tool, and the widget's
  provenance names that job
