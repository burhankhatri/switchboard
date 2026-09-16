/** Longest name we will derive. Long enough to identify, short enough to list. */
const MAX_NAME = 60

/**
 * A job name derived from the prompt it was created out of.
 *
 * "Schedule this" turns a message into a job, and the only field the person
 * would otherwise have to invent is the name. Deriving one makes the common
 * case a single click; it is seeded into an editable field, not forced, so a
 * bad guess costs nothing.
 *
 * Returns "" when nothing usable is left, and the form asks for a name as it
 * always did.
 */
export function scheduleNameFromPrompt(prompt: string): string {
  // First sentence or line, whichever ends sooner — a prompt's opening clause
  // is what it is for, and the rest is how.
  const firstLine = prompt.trim().split("\n").find((l) => l.trim()) ?? ""
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine

  const cleaned = firstSentence
    .trim()
    // Markdown a heading or a bullet would otherwise drag into the name.
    .replace(/^[#>\-*\s]+/, "")
    // Backticks and asterisks only. Underscores are emphasis in theory and
    // part of a filename in practice, and these prompts name scripts:
    // stripping them turned campaign_audit.mjs into campaignaudit.mjs.
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "")
    .trim()

  if (!cleaned) return ""
  if (cleaned.length <= MAX_NAME) return cleaned

  // Cut on a word boundary rather than mid-word, then ellipsise so it is
  // visibly truncated instead of looking like the whole name.
  const cut = cleaned.slice(0, MAX_NAME - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
