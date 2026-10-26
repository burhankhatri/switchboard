## Purpose
The page a member lands on when they open a workspace: what the workspace does,
what is running in it, what it has produced and what has happened since they
last looked — written so a member who did not build any of it can follow it.

## ADDED Requirements

### Requirement: An open workspace lands on its home page
The system SHALL show the workspace home page in the centre pane when a member
has a workspace open and no chat, file or scheduled agents view in that pane.
The page SHALL show, in order: the brief, the since-last-visit summary, the
start-a-chat action, widgets, the workspace's jobs, and recent activity.

#### Scenario: Opening a workspace
- **WHEN** a member opens a workspace with no chat selected
- **THEN** its home page is shown, with every section populated from the whole
  workspace rather than from the member's own chats and jobs

#### Scenario: A member who built nothing
- **WHEN** a member who created no chats or jobs opens a workspace where another
  member has set up jobs and pinned widgets
- **THEN** they see those jobs and widgets, because what the workspace does must
  not depend on who did it

#### Scenario: A non-member
- **WHEN** a signed-in user who is not a member requests a workspace's home data
- **THEN** the request is rejected with 403

### Requirement: The brief is HOME.md in the workspace folder
The system SHALL render `HOME.md` at the root of the workspace folder as the
brief at the top of the home page, and SHALL treat it as an ordinary workspace
file for editing and committing.

#### Scenario: A workspace with a brief
- **WHEN** the workspace folder contains `HOME.md`
- **THEN** it is shown rendered, with an Edit action that opens it in the file
  editor, where saving commits as for any other file

#### Scenario: A workspace without a brief
- **WHEN** the workspace folder has no `HOME.md`
- **THEN** the home page offers to have the agent draft one, which starts a chat
  asking the agent to write `HOME.md` from the workspace's skills, scripts,
  connections and jobs in plain language

#### Scenario: The agent updates the brief
- **WHEN** a run changes `HOME.md` and its changes reach the workspace branch
- **THEN** the home page shows the new brief on next load, because the repo is
  the brief's only source

### Requirement: Every member sees the workspace's jobs
The system SHALL list every approved scheduled job bound to the workspace on its
home page, whoever created it, with its name, its schedule in words, its author,
whether it is enabled, its last run's time and outcome, and a health state.
Control over a job SHALL remain with its author.

#### Scenario: Health
- **WHEN** a job's most recent run failed
- **THEN** it shows as failing, with the failure count; a job whose last run
  completed shows as healthy; a disabled job shows as paused

#### Scenario: Someone else's job
- **WHEN** a member views a job created by another member
- **THEN** they can open its runs and the chats those runs produced, and are not
  offered edit, delete, enable or run-now

#### Scenario: A job awaiting approval
- **WHEN** an agent has proposed a job that has not been approved
- **THEN** it is listed under "Awaiting approval" with who it is waiting on,
  rather than mixed in with jobs that run

### Requirement: The workspace keeps an activity feed
The system SHALL record workspace events and show them newest first on the home
page, each with what happened, who or which job caused it, when, and a link to
the thing itself. Events SHALL be recorded for: a job created, approved,
disabled or deleted; a scheduled run completed or failed; files committed to the
workspace from the app or by a run; a widget pinned, updated by a person, or
removed; a member joining or leaving; a chat shared to the workspace.

#### Scenario: A run fails
- **WHEN** a scheduled run in the workspace ends in error
- **THEN** the feed shows the job's name, that it failed, when, and links to the
  run's chat

#### Scenario: Private chats are not events
- **WHEN** a member starts or messages in a chat that is not shared to the
  workspace
- **THEN** no event names or links to that chat

#### Scenario: Routine widget refreshes
- **WHEN** a run refreshes a widget's data through the agent tools
- **THEN** the widget's provenance changes, but no feed event is added, so a
  daily refresh does not bury everything else

#### Scenario: A long history
- **WHEN** a workspace has more events than the first page shows
- **THEN** older events load on request, newest first

### Requirement: Widgets are typed cards, never markup
The system SHALL support home widgets of exactly these types: stat, table,
chart, file, job and note. A widget's content SHALL be structured data checked
against its type's schema on every write; no widget type SHALL accept HTML,
script or a URL the browser loads automatically.

#### Scenario: Each type
- **WHEN** a widget is shown
- **THEN** a stat shows a label, a value and an optional change and note; a table
  shows up to 50 rows of named columns; a chart shows a line or bar chart of up
  to 500 points across up to 6 series; a file shows a preview of a workspace file
  by path; a job shows the live status of one workspace job; a note shows
  Markdown rendered without raw HTML

#### Scenario: Invalid content
- **WHEN** a write supplies content that does not match its type's schema, or
  exceeds 64 KB serialised
- **THEN** it is rejected with the reason, and the widget's previous content is
  kept

#### Scenario: A file or job that no longer exists
- **WHEN** a file widget's path is deleted, or a job widget's job is deleted
- **THEN** the widget says so instead of failing the page

#### Scenario: Links in content
- **WHEN** widget content includes a link
- **THEN** it is shown as a link that opens only when clicked, in a new tab, and
  only for http and https

### Requirement: Members create and arrange widgets
The system SHALL let any member add, edit, reorder and remove widgets on the
home page, from the home page itself, from a chat message, and from a workspace
file. Every change SHALL be attributed to the member who made it.

#### Scenario: Adding by hand
- **WHEN** a member adds a note, file or job widget from the home page
- **THEN** it appears on home for every member

#### Scenario: Pinning from a chat
- **WHEN** a member chooses Pin to Home on an assistant message containing a
  table or a single headline figure
- **THEN** a table or stat widget is created from that content, linked back to
  the message; any other message is pinned as a note

#### Scenario: Pinning a file
- **WHEN** a member chooses Pin to Home on a workspace file
- **THEN** a file widget for that path is created

#### Scenario: Removing another member's widget
- **WHEN** a member removes a widget someone else created
- **THEN** it is removed for everyone, and the feed records who removed it

### Requirement: Every widget shows where its content came from
The system SHALL show on each widget who last changed its content and when,
and, when the change came from an agent, which chat or scheduled job it came
from, linked to it.

#### Scenario: Refreshed by a scheduled job
- **WHEN** a scheduled run updates a widget
- **THEN** the widget reads "Updated by <job name>" with the time, linking to that
  run's chat

#### Scenario: Created in a chat
- **WHEN** an agent creates a widget during an interactive chat
- **THEN** the widget names the member whose chat it was and links to the chat
  if that chat is shared to the workspace, and otherwise names the member only

#### Scenario: Stale data
- **WHEN** a widget bound to a job has not been updated for more than twice that
  job's interval
- **THEN** it is marked stale, so an outdated number is not read as current

### Requirement: Home shows what changed since the member last looked
The system SHALL record when each member last viewed a workspace's home page and
SHALL show a summary of the events since then, as counts and up to five
highlights, with failures listed first.

#### Scenario: Returning after a week
- **WHEN** a member opens home after other activity since their last visit
- **THEN** they see, for example, "Since Tuesday: 6 runs, 1 failing job, 2 widgets
  updated, 1 chat shared", with the failing job first

#### Scenario: Nothing new
- **WHEN** nothing has happened since the member's last visit
- **THEN** the summary is not shown

#### Scenario: First visit
- **WHEN** a member opens a workspace's home for the first time
- **THEN** the summary covers the last 7 days
