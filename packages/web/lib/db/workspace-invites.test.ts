import { describe, it, expect, vi, beforeEach } from "vitest"

// Same idiom as notifications.test.ts: mock the prisma singleton so the claim
// path can be exercised without a database.
const { workspaceInvite, workspaceMember, $transaction } = vi.hoisted(() => ({
  workspaceInvite: { findMany: vi.fn(), delete: vi.fn() },
  workspaceMember: { createMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspaceInvite, workspaceMember, $transaction },
}))

const { logActivityAsync } = vi.hoisted(() => ({ logActivityAsync: vi.fn() }))
vi.mock("@/lib/db/activity-log", () => ({ logActivityAsync }))

const { notifyAsync } = vi.hoisted(() => ({ notifyAsync: vi.fn() }))
vi.mock("@/lib/db/notifications", () => ({ notifyAsync }))

import {
  normalizeGithubLogin,
  isValidGithubLogin,
  claimInvitesForLogin,
} from "./workspace-invites"

const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv1",
  role: "member",
  invitedById: "u-owner",
  workspace: { id: "w1", name: "GTM Lead Engine", slug: "gtm-lead-engine" },
  ...over,
})

beforeEach(() => {
  workspaceInvite.findMany.mockReset().mockResolvedValue([])
  workspaceInvite.delete.mockReset().mockReturnValue({ __op: "delete" })
  workspaceMember.createMany.mockReset().mockReturnValue({ __op: "createMany" })
  $transaction.mockReset().mockResolvedValue([])
  logActivityAsync.mockReset()
  notifyAsync.mockReset()
})

describe("normalizeGithubLogin", () => {
  it("lowercases, because an invite and a sign-in must collide", () => {
    expect(normalizeGithubLogin("BurhanKhatri")).toBe("burhankhatri")
  })

  it("strips a leading @ and surrounding whitespace", () => {
    expect(normalizeGithubLogin("  @Burhan  ")).toBe("burhan")
  })

  it("accepts a pasted profile URL", () => {
    expect(normalizeGithubLogin("https://github.com/Chemicoholic21")).toBe("chemicoholic21")
    expect(normalizeGithubLogin("github.com/burhan/")).toBe("burhan")
  })
})

describe("isValidGithubLogin", () => {
  it("accepts real handle shapes", () => {
    expect(isValidGithubLogin("burhankhatri")).toBe(true)
    expect(isValidGithubLogin("a-b-c1")).toBe(true)
    expect(isValidGithubLogin("a")).toBe(true)
  })

  it("rejects things that identify nobody at sign-in", () => {
    // An email is the important one: the dialog accepts emails for existing
    // users, and holding an invite against one would never match — GitHub
    // reports a login and nothing else.
    expect(isValidGithubLogin("someone@example.com")).toBe(false)
    expect(isValidGithubLogin("")).toBe(false)
    expect(isValidGithubLogin("-leading")).toBe(false)
    expect(isValidGithubLogin("trailing-")).toBe(false)
    expect(isValidGithubLogin("double--hyphen")).toBe(false)
    expect(isValidGithubLogin("a".repeat(40))).toBe(false)
  })
})

describe("claimInvitesForLogin", () => {
  it("matches the invite regardless of the case GitHub reports", async () => {
    workspaceInvite.findMany.mockResolvedValue([invite()])

    await claimInvitesForLogin("u-new", "BurhanKhatri")

    expect(workspaceInvite.findMany.mock.calls[0][0].where).toMatchObject({
      githubLogin: "burhankhatri",
    })
  })

  it("creates membership with the invited role and consumes the invite", async () => {
    workspaceInvite.findMany.mockResolvedValue([invite({ role: "owner" })])

    const claimed = await claimInvitesForLogin("u-new", "burhankhatri")

    expect(workspaceMember.createMany).toHaveBeenCalledWith({
      data: [{ workspaceId: "w1", userId: "u-new", role: "owner" }],
      skipDuplicates: true,
    })
    expect(workspaceInvite.delete).toHaveBeenCalledWith({ where: { id: "inv1" } })
    expect(claimed).toEqual([
      { workspaceId: "w1", workspaceName: "GTM Lead Engine", role: "owner" },
    ])
  })

  it("writes the membership and the deletion in one transaction", async () => {
    // Half of this landing is the bad outcome: an invite consumed with no
    // membership strands them, a membership with a live invite re-adds them
    // after a later removal.
    workspaceInvite.findMany.mockResolvedValue([invite()])

    await claimInvitesForLogin("u-new", "burhankhatri")

    expect($transaction).toHaveBeenCalledTimes(1)
    expect($transaction.mock.calls[0][0]).toHaveLength(2)
  })

  it("skips archived workspaces", async () => {
    await claimInvitesForLogin("u-new", "burhankhatri")

    expect(workspaceInvite.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { archived: false },
    })
  })

  it("tells the new user, crediting whoever invited them", async () => {
    workspaceInvite.findMany.mockResolvedValue([invite()])

    await claimInvitesForLogin("u-new", "burhankhatri")

    expect(notifyAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-new",
        actorId: "u-owner",
        kind: "workspace_member_added",
        workspaceId: "w1",
      })
    )
  })

  it("claims the rest when one invite fails", async () => {
    workspaceInvite.findMany.mockResolvedValue([
      invite({ id: "bad", workspace: { id: "w1", name: "One", slug: "one" } }),
      invite({ id: "good", workspace: { id: "w2", name: "Two", slug: "two" } }),
    ])
    $transaction.mockRejectedValueOnce(new Error("deadlock"))

    const claimed = await claimInvitesForLogin("u-new", "burhankhatri")

    expect(claimed).toEqual([{ workspaceId: "w2", workspaceName: "Two", role: "member" }])
  })

  it("never throws — a failed claim must not cost a sign-in", async () => {
    workspaceInvite.findMany.mockRejectedValue(new Error("database is down"))

    await expect(claimInvitesForLogin("u-new", "burhankhatri")).resolves.toEqual([])
  })

  it("does nothing without a handle", async () => {
    expect(await claimInvitesForLogin("u-new", "  ")).toEqual([])
    expect(workspaceInvite.findMany).not.toHaveBeenCalled()
  })
})
