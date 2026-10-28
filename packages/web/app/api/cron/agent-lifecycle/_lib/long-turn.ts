import { INTERACTIVE_HARD_TIMEOUT, INTERACTIVE_WARN_MINUTES } from "./constants"

export interface LongTurnNotice {
  title: string
  body: string
}

/**
 * The warning a person gets when an interactive turn has run long enough that
 * the hard timeout is in sight. The agent cannot be told (there is no way to
 * inject text into a running headless turn), so this goes to the person, who
 * can stop it or let it run.
 */
export function longTurnNotice(minutesRunning: number): LongTurnNotice | null {
  if (minutesRunning < INTERACTIVE_WARN_MINUTES) return null
  return {
    title: `An agent has been running for ${INTERACTIVE_WARN_MINUTES} minutes`,
    body:
      `It will be stopped at ${INTERACTIVE_HARD_TIMEOUT} minutes if it has not finished. ` +
      "Long jobs are better started and then checked in a later turn.",
  }
}
