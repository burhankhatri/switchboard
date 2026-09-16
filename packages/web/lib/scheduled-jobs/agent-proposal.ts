/**
 * Shared rules for a job an agent proposed, rather than a person filled in.
 *
 * Kept apart from the form's own config because the constraints differ: a
 * person picks from a list of intervals and sees the result, while an agent
 * passes a number it inferred from a sentence and nobody sees it until later.
 */

/**
 * Shortest interval an agent may propose.
 *
 * Matches the floor the form enforces. The cron ticks every minute, so ten is
 * a schedule the system can actually keep rather than a number that rounds up
 * to the next sweep.
 */
export const MIN_INTERVAL_MINUTES = 10

/** Longest interval — beyond a year the schedule is not really a schedule. */
export const MAX_INTERVAL_MINUTES = 525_600

/**
 * How many unapproved jobs one workspace may hold.
 *
 * Nothing an agent proposes runs, so this is not about execution. It is about
 * attention: a looping agent can fill an approval queue faster than a person
 * can read it, and a queue nobody reads is a gate that has stopped working.
 */
export const MAX_AGENT_JOBS_PER_WORKSPACE = 10

export type IntervalCheck =
  | { ok: true; minutes: number }
  | { ok: false; reason: string }

/**
 * Validate an interval an agent supplied.
 *
 * The failure strings are addressed to the model, because they come back as
 * the tool result and are the only thing it has to work out what to do next.
 * Each one says what to do, not just what was wrong.
 */
export function normalizeInterval(raw: unknown): IntervalCheck {
  const minutes = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(minutes)) {
    return {
      ok: false,
      reason:
        "intervalMinutes must be a number of minutes. Ask the user how often this should run " +
        "rather than guessing — 1440 is daily, 10080 is weekly.",
    }
  }
  const whole = Math.floor(minutes)
  if (whole < MIN_INTERVAL_MINUTES) {
    return {
      ok: false,
      reason:
        `The shortest supported interval is ${MIN_INTERVAL_MINUTES} minutes. ` +
        "Propose something less frequent.",
    }
  }
  if (whole > MAX_INTERVAL_MINUTES) {
    return { ok: false, reason: "That interval is longer than a year. Propose something shorter." }
  }
  return { ok: true, minutes: whole }
}

/** Plain-English interval, for a notification and for the tool's reply. */
export function describeInterval(minutes: number): string {
  const units: [number, string][] = [
    [10080, "week"],
    [1440, "day"],
    [60, "hour"],
    [1, "minute"],
  ]
  for (const [size, label] of units) {
    if (minutes % size === 0) {
      const count = minutes / size
      return count === 1 ? `every ${label}` : `every ${count} ${label}s`
    }
  }
  return `every ${minutes} minutes`
}
