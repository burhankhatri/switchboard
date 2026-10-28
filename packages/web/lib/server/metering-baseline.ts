/**
 * Whether a session's first ledger rows should be backdated out of every
 * budget window.
 *
 * tokscale reports a session's cumulative usage. When metering first sees a
 * session that was already running before metering existed, that cumulative
 * covers the whole pre-metering backlog, and charging it as one turn would
 * lock the user out. Those rows are dated 1970: they still advance the diff
 * cursor but count against no day.
 *
 * The old rule backdated any session new to the ledger in a chat with earlier
 * turns. A new sandbox or an agent switch starts a fresh session mid-chat, and
 * a fresh session's cumulative is only its own first turn, so the rule hid
 * real spend: 61 sessions in 13 chats and $23.46 of $47.50 in production by
 * 2026-10-28. A backlog exists only when the session is the one the chat was
 * already resuming.
 */
export function shouldBackdateBaseline(p: {
  /** Ledger rows already recorded for this session. */
  priorCaptures: number
  /** Assistant messages in the chat, including this turn's. */
  assistantTurns: number
  /** The chat's session id before this turn finalised. */
  chatSessionBefore: string | null | undefined
  /** The session this turn ran in. */
  sessionId: string
}): boolean {
  if (p.priorCaptures > 0) return false
  if (p.assistantTurns <= 1) return false
  return !!p.chatSessionBefore && p.chatSessionBefore === p.sessionId
}
