// Hard timeouts for agent runs, in minutes. Past these the cron forcibly stops
// the agent and marks the chat/run as errored.
// Interactive turns get 90 minutes (25 until 2026-10-28): slow, sanctioned work
// such as an enrichment or the pricing bot was being killed at 25. The cron
// checks each running sandbox every minute, which also keeps Daytona from
// stopping it as idle, so a long turn keeps its sandbox. A runaway now costs up
// to 90 minutes of tokens and holds one of Daytona's six sandboxes that long.
export const INTERACTIVE_HARD_TIMEOUT = 90 // minutes
export const SCHEDULED_HARD_TIMEOUT = 20 // minutes

// Minutes into an interactive turn at which the person is told the hard stop
// is coming. Five minutes is enough to decide whether to let it run out or to
// stop it and continue in a fresh turn; the agent itself cannot be interrupted.
export const INTERACTIVE_WARN_MINUTES = INTERACTIVE_HARD_TIMEOUT - 5
