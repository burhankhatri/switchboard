/**
 * The signal that a turn ended because the agent is waiting on you.
 *
 * A blocked turn and a finished turn were previously identical in the database
 * — same Chat.status, same message shape — because the system prompt asks the
 * agent to write its questions as prose and end the turn. So nothing could
 * surface "this chat is waiting on you" without guessing.
 *
 * Question-detection was the alternative and it is worse: an agent that
 * finishes the work and closes with "want me to keep going?" is not blocked,
 * and pinging someone for that trains them to ignore the badge.
 *
 * An HTML comment is the marker on purpose. react-markdown runs without
 * rehype-raw, which drops HTML rather than rendering it, so if any path ever
 * forgets to strip this the reader sees nothing instead of markup. Stripping is
 * still done on every path — this is the floor, not the plan.
 */

export const NEEDS_INPUT_MARKER = "<!--needs-input-->"

/** Whitespace-tolerant: models reproduce a literal inconsistently. */
const MARKER_PATTERN = /<!--\s*needs-input\s*-->/gi

export interface NeedsInputResult {
  /** The content with every marker removed, safe to store and render. */
  content: string
  /** Whether the agent signalled it is waiting for a reply. */
  needsInput: boolean
}

export function extractNeedsInput(content: string | undefined | null): NeedsInputResult {
  if (!content) return { content: "", needsInput: false }

  MARKER_PATTERN.lastIndex = 0
  if (!MARKER_PATTERN.test(content)) {
    return { content, needsInput: false }
  }

  const stripped = content.replace(MARKER_PATTERN, "")
  // Collapse the blank line the marker usually sat on, then trim both ends: a
  // marker at the start leaves a leading newline just as one at the end leaves
  // a trailing one, and neither should reach the transcript.
  return {
    content: stripped.replace(/\n{3,}/g, "\n\n").trim(),
    needsInput: true,
  }
}
