# app-navigation

## Purpose
How people move around the app: a rail of categories down the left edge, each
opening its own panel beside it. The sidebar used to stack chats, skills, files,
connections and runs in one column with two scroll regions, and whichever
section you needed was the one cut off.

## Requirements

### Requirement: One category owns the panel
The system SHALL show a rail of five categories — Chats, Skills, Files,
Connections and Runs — and SHALL give the whole panel to the selected one.

#### Scenario: Picking a category
- **WHEN** a member picks a category on the rail
- **THEN** the panel shows only that category, with its title, its actions, and
  a single scrolling list

#### Scenario: A long list
- **WHEN** a category has more items than fit on screen
- **THEN** the panel scrolls to the last of them, because no other section
  shares its height

#### Scenario: No workspace open
- **WHEN** no workspace is open
- **THEN** the rail still shows every category in the same place, and the panel
  explains that picking a workspace fills them

### Requirement: Scheduled agents live under Runs
The system SHALL reach scheduled agents from the Runs panel, above the
workspace's recent runs.

#### Scenario: Opening scheduled agents
- **WHEN** a member picks Scheduled in the Runs panel
- **THEN** the scheduled agents view opens at /jobs, because a schedule is how
  unattended work starts and a run is what it did

### Requirement: The rail flags what needs attention
The system SHALL mark Chats on the rail while a chat in the open workspace is
waiting on the member's reply, and Runs while a run is in progress.

#### Scenario: A chat waiting on you
- **WHEN** a chat in the open workspace is awaiting input
- **THEN** Chats carries a dot on the rail from any category, and the Chats
  panel lists that chat first under "Needs you"

### Requirement: The panel follows the main pane
The system SHALL switch the panel to the category of what the main pane opens
from elsewhere.

#### Scenario: Opening a chat from the palette or a notification
- **WHEN** a chat opens in the main pane
- **THEN** the panel switches to Chats, so the open chat is listed

#### Scenario: Landing on /jobs
- **WHEN** the scheduled agents view opens
- **THEN** the panel switches to Runs

### Requirement: The sidebar remembers its state
The system SHALL restore the selected category and whether the panel was
collapsed after a reload.

#### Scenario: Reloading
- **WHEN** a member reloads the app
- **THEN** the last category they picked is open, and a collapsed panel stays
  collapsed

#### Scenario: A value from an older build
- **WHEN** the saved category is one the rail no longer offers
- **THEN** Chats opens instead of an empty panel

### Requirement: Collapsing leaves the rail
The system SHALL keep the rail visible when the panel is collapsed, and SHALL
reopen the panel when a category is picked.

#### Scenario: Collapsed
- **WHEN** a member collapses the sidebar
- **THEN** only the rail remains, one click from any category

### Requirement: One sidebar on every screen size
The system SHALL render the same rail and panel in the mobile drawer as on
desktop.

#### Scenario: Phone-sized screen
- **WHEN** a member opens the menu on a narrow screen
- **THEN** the drawer holds the rail and the panel, and switching categories
  works as it does on desktop

### Requirement: An opened file owns the centre pane
The system SHALL show a file opened from the Skills or Files panel in the
centre pane, whatever the pane was showing, and SHALL keep it open while the
member uses the sidebar.

#### Scenario: Opening a skill from the home page
- **WHEN** a member with no chat open clicks a skill
- **THEN** the skill opens in the editor, because the home page is where most
  people are when they go looking for one

#### Scenario: Clicking around the sidebar
- **WHEN** a file is open and the member switches category, expands a folder or
  opens a menu
- **THEN** the file stays open; it closes from its own tab, or when a chat or
  the scheduled agents view takes the pane
