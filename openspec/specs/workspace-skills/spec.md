# workspace-skills

## Purpose
Adding and browsing the skills a workspace teaches its agent. A skill is a
folder at `.claude/skills/<slug>/SKILL.md` inside the workspace, and that path
is the whole discovery mechanism — so placement is the system's job, not the
author's.

## Requirements

### Requirement: Skills are the workspace's primary view
The system SHALL present a workspace's skills as a named list in their own
sidebar panel, separate from the file tree.

#### Scenario: Opening the Skills panel
- **WHEN** a member picks Skills on the sidebar rail
- **THEN** the workspace's skills are listed by name and description, because a
  skill is what the workspace is for and a file is an implementation detail of
  one

#### Scenario: Reaching the files
- **WHEN** a member needs a script, a fixture or the workspace config
- **THEN** the full file tree is in the Files panel, so nothing is unreachable —
  it just no longer sits between people and the skills

### Requirement: The system places a new skill
The system SHALL derive a new skill's path from its name, server-side.

#### Scenario: Adding a skill
- **WHEN** a member submits a skill name and description
- **THEN** it is committed to `<workspace>/.claude/skills/<slug>/SKILL.md`,
  because a SKILL.md one directory off is one the agent will never read, and
  whoever is adding knowledge to a workspace cannot be expected to know that

#### Scenario: A name that is not a directory name
- **WHEN** the name contains spaces, punctuation or path traversal
- **THEN** it is slugified to lowercase and hyphens, and rejected if nothing
  usable remains, rather than committed as a folder that escapes the skills
  directory

#### Scenario: A name already taken
- **WHEN** a skill with that slug already exists in the workspace
- **THEN** the request is refused, because the write would otherwise replace
  a skill someone else wrote

### Requirement: A skill must say when to use it
The system SHALL require a description when a skill is created.

#### Scenario: Creating without a description
- **WHEN** a member submits a skill with no description
- **THEN** it is refused, because the description is what the model matches a
  task against — a skill without one is a file the agent will never open

#### Scenario: An existing skill with no description
- **WHEN** a committed SKILL.md has no `description` in its frontmatter
- **THEN** the list says so against that skill rather than showing a blank
  line, since it is a fault to fix and not an empty field

### Requirement: A skill is committed, like any other workspace file
The system SHALL persist a new skill as a commit to the workspaces repo,
attributed to the member who added it.

#### Scenario: Adding a skill
- **WHEN** a member adds a skill
- **THEN** it is committed to the workspaces repo, so the next run clones it
  with no further step — the repo stays the single source of truth

#### Scenario: A non-member
- **WHEN** someone who is not a member of the workspace posts to the endpoint
- **THEN** it is refused, on the same membership check reads use
