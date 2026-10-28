// Hard timeouts for agent runs, in minutes. Past these the cron forcibly stops
// the agent and marks the chat/run as errored.
export const INTERACTIVE_HARD_TIMEOUT = 25 // minutes
export const SCHEDULED_HARD_TIMEOUT = 20 // minutes

// Minutes into an interactive turn at which the person is told the hard stop
// is coming. Five minutes is enough to decide whether to let it run out or to
// stop it and continue in a fresh turn; the agent itself cannot be interrupted.
export const INTERACTIVE_WARN_MINUTES = INTERACTIVE_HARD_TIMEOUT - 5
