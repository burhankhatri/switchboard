import { describe, it, expect } from "vitest"
import { shouldBackdateBaseline } from "./metering-baseline"

/**
 * The first ledger rows for a session are backdated to 1970 when they would
 * otherwise charge a backlog that predates metering. In production that rule
 * fired for 61 sessions in 13 chats, including fresh sessions started mid-chat
 * (a new sandbox, an agent switch), and hid $23.46 of $47.50 from every daily
 * budget window. A fresh session's cumulative covers only its own turns, so
 * there is no backlog to protect.
 */
describe("shouldBackdateBaseline", () => {
  it("charges a session that already has ledger rows", () => {
    expect(shouldBackdateBaseline({ priorCaptures: 2, assistantTurns: 9, chatSessionBefore: "s1", sessionId: "s1" })).toBe(false)
  })

  it("charges the first turn of a new chat", () => {
    expect(shouldBackdateBaseline({ priorCaptures: 0, assistantTurns: 1, chatSessionBefore: null, sessionId: "s1" })).toBe(false)
  })

  it("backdates a resumed session that has turns from before metering", () => {
    expect(shouldBackdateBaseline({ priorCaptures: 0, assistantTurns: 5, chatSessionBefore: "s1", sessionId: "s1" })).toBe(true)
  })

  it("charges a fresh session started in a chat that already had turns", () => {
    expect(shouldBackdateBaseline({ priorCaptures: 0, assistantTurns: 5, chatSessionBefore: "s-old", sessionId: "s-new" })).toBe(false)
    expect(shouldBackdateBaseline({ priorCaptures: 0, assistantTurns: 5, chatSessionBefore: null, sessionId: "s-new" })).toBe(false)
  })
})
