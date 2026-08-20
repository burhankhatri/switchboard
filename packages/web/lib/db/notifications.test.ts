import { describe, it, expect, vi, beforeEach } from "vitest"

// Same idiom as activity-log.test.ts: mock the prisma singleton so the writer
// can be exercised without a database.
const { notification } = vi.hoisted(() => ({
  notification: {
    create: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { notification } }))

import { notify, notifyAsync, unreadCount, markRead } from "./notifications"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  notification.create.mockReset().mockResolvedValue({})
  notification.count.mockReset().mockResolvedValue(0)
  notification.updateMany.mockReset().mockResolvedValue({ count: 0 })
})

describe("notify", () => {
  it("records a notification for the recipient", async () => {
    await notify({
      userId: "u-recipient",
      actorId: "u-actor",
      kind: "workspace_member_added",
      title: "Wayne added you to GTM-Lead-Engine",
      workspaceId: "w1",
    })

    expect(notification.create).toHaveBeenCalledTimes(1)
    const { data } = notification.create.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: "u-recipient",
      kind: "workspace_member_added",
      title: "Wayne added you to GTM-Lead-Engine",
      workspaceId: "w1",
    })
  })

  it("never notifies the person who caused the event", async () => {
    // Adding yourself to a workspace, or answering your own agent, must not
    // ping you. This is the easiest thing to get wrong and the most annoying
    // to live with.
    await notify({
      userId: "u1",
      actorId: "u1",
      kind: "workspace_member_added",
      title: "You added yourself",
      workspaceId: "w1",
    })

    expect(notification.create).not.toHaveBeenCalled()
  })

  it("still notifies when there is no actor (system-generated)", async () => {
    // An agent asking a question has no human actor.
    await notify({
      userId: "u1",
      kind: "agent_needs_input",
      title: "Your agent has a question",
      chatId: "c1",
    })

    expect(notification.create).toHaveBeenCalledTimes(1)
  })

  it("does not throw when the write fails", async () => {
    // A failed notification must never take down the request that triggered it
    // — being added to a workspace matters more than being told about it.
    notification.create.mockRejectedValue(new Error("db down"))
    await expect(
      notify({ userId: "u1", kind: "agent_needs_input", title: "x" })
    ).resolves.toBeUndefined()
  })
})

describe("notifyAsync", () => {
  it("is fire-and-forget and still writes", async () => {
    notifyAsync({ userId: "u1", kind: "agent_needs_input", title: "x" })
    await flush()
    expect(notification.create).toHaveBeenCalledTimes(1)
  })
})

describe("unreadCount", () => {
  it("counts only this user's unread notifications", async () => {
    notification.count.mockResolvedValue(3)
    const n = await unreadCount("u1")
    expect(n).toBe(3)
    expect(notification.count.mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", readAt: null },
    })
  })

  it("reports zero rather than throwing when the count fails", async () => {
    notification.count.mockRejectedValue(new Error("db down"))
    await expect(unreadCount("u1")).resolves.toBe(0)
  })
})

describe("markRead", () => {
  it("marks only the named notifications, scoped to the user", async () => {
    notification.updateMany.mockResolvedValue({ count: 2 })
    await markRead("u1", ["n1", "n2"])
    const arg = notification.updateMany.mock.calls[0][0]
    // Scoping by userId matters: without it, passing someone else's id would
    // let you mark their notifications read.
    expect(arg.where).toMatchObject({ userId: "u1", id: { in: ["n1", "n2"] } })
    expect(arg.data.readAt).toBeInstanceOf(Date)
  })

  it("marks everything unread for the user when no ids are given", async () => {
    await markRead("u1")
    const arg = notification.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ userId: "u1", readAt: null })
    expect(arg.where.id).toBeUndefined()
  })
})
