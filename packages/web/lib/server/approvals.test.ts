import { describe, it, expect, vi } from "vitest"
import { consumeApprovalEnv, describeApproval, type ApprovalClient } from "./approvals"

/**
 * The "only when the user asks in that turn" rule is prose in five skills and
 * has drifted once already (LEARNINGS 29). This makes it mechanical: a script's
 * --apply needs SWITCHBOARD_APPROVAL in its environment, the variable exists
 * only when a person clicked Approve on this chat, and it is spent by the turn
 * that receives it.
 */
function client(approved: { id: string }[] = []) {
  const findFirst = vi.fn().mockResolvedValue(approved[0] ?? null)
  const update = vi.fn().mockResolvedValue({})
  return { prisma: { chatApproval: { findFirst, update } } as unknown as ApprovalClient, findFirst, update }
}

describe("consumeApprovalEnv", () => {
  it("hands an approved, unused approval to the turn and marks it used", async () => {
    const c = client([{ id: "apr_1" }])
    const env = await consumeApprovalEnv(c.prisma, "chat-1")
    expect(env).toEqual({ SWITCHBOARD_APPROVAL: "apr_1" })
    expect(c.findFirst.mock.calls[0][0]).toMatchObject({
      where: { chatId: "chat-1", status: "approved" },
    })
    expect(c.update.mock.calls[0][0]).toMatchObject({
      where: { id: "apr_1" },
      data: { status: "used" },
    })
  })

  it("gives nothing when no approval is waiting", async () => {
    const c = client()
    expect(await consumeApprovalEnv(c.prisma, "chat-1")).toEqual({})
    expect(c.update).not.toHaveBeenCalled()
  })
})

describe("describeApproval", () => {
  it("says what the click would allow, in the person's terms", () => {
    expect(describeApproval({ action: "add leads to campaign", count: 16, campaign: "DFW industrial (7c08d5fb)" })).toBe(
      "add leads to campaign: 16, campaign DFW industrial (7c08d5fb)"
    )
    expect(describeApproval({ action: "enrich buildings", count: 40, campaign: null })).toBe("enrich buildings: 40")
    expect(describeApproval({ action: "create the draft campaign", count: null, campaign: null })).toBe(
      "create the draft campaign"
    )
  })
})
