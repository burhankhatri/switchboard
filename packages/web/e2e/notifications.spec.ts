import { test, expect, type Page, type BrowserContext } from "@playwright/test"
import { setupTestAuth } from "./helpers"

/**
 * Notifications, end to end.
 *
 * Tagged @no-sandbox: none of these need Daytona, so CI can run them without a
 * Daytona key. The membership flow drives the real
 * POST /api/workspaces/[id]/members route — only the workspace row itself is
 * created through a test-only endpoint, because the real creation route writes
 * to GitHub and E2E has no token for it.
 */

// Recipients are per-repeat. The database is reset once per run, not per test,
// so a fixed address accumulates one more notification on every --repeat-each
// pass and any exact-count assertion only holds on the first.
const otherUser = (repeat: number) => ({
  email: `second-${repeat}@playwright.local`,
  name: "Second User",
})

// The UI test gets its own recipient, fresh per repeat. The database is reset
// once per run, not per test, so a fixed address would accumulate one more
// notification on every --repeat-each pass and the screenshot would only match
// on the first.
const bellUser = (repeat: number) => ({
  email: `bell-${repeat}@playwright.local`,
  name: "Bell User",
})

/** Sign a context in as a specific test user and return their id. */
async function authAs(
  page: Page,
  context: BrowserContext,
  who?: { email: string; name: string }
): Promise<string> {
  if (!who) {
    await setupTestAuth(page, context)
    const res = await page.request.post("/api/test/auth")
    return (await res.json()).userId
  }

  const res = await page.request.post("/api/test/auth", { data: who })
  expect(res.ok()).toBeTruthy()
  const { token, userId } = await res.json()
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ])
  return userId
}

test.describe("notifications API @no-sandbox", () => {
  test("requires authentication", async ({ page }) => {
    // No cookies on this context.
    const res = await page.request.get("/api/notifications")
    expect(res.status()).toBe(401)
  })

  test("returns a list and an unread count", async ({ page, context }) => {
    await authAs(page, context)
    const res = await page.request.get("/api/notifications")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.notifications)).toBe(true)
    expect(typeof body.unreadCount).toBe("number")
  })

  test("reports push as unconfigured when no VAPID keys are set", async ({ page, context }) => {
    await authAs(page, context)
    const res = await page.request.get("/api/notifications/subscribe")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // The control hides itself on this, rather than offering a button that
    // cannot work.
    expect(typeof body.enabled).toBe("boolean")
    if (!body.enabled) {
      const post = await page.request.post("/api/notifications/subscribe", {
        data: { endpoint: "https://example.com/x", keys: { p256dh: "a", auth: "b" } },
      })
      expect(post.status()).toBe(400)
    }
  })

  test("rejects a malformed subscription", async ({ page, context }) => {
    await authAs(page, context)
    const res = await page.request.post("/api/notifications/subscribe", {
      data: { endpoint: "https://example.com/x" }, // no keys
    })
    expect([400, 401]).toContain(res.status())
  })
})

test.describe("workspace membership notification @no-sandbox", () => {
  test("tells the added member, and not the person who added them", async (
    { page, context, browser },
    testInfo
  ) => {
    const OTHER = otherUser(testInfo.repeatEachIndex)
    // ── owner creates a workspace and adds someone ──
    const ownerId = await authAs(page, context)

    const wsRes = await page.request.post("/api/test/workspace", {
      data: { name: "Notify Test" },
    })
    expect(wsRes.ok()).toBeTruthy()
    const { workspace } = await wsRes.json()

    // Make sure the other user exists before adding them by email.
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await authAs(otherPage, otherContext, OTHER)

    const addRes = await page.request.post(`/api/workspaces/${workspace.id}/members`, {
      data: { identifier: OTHER.email, role: "member" },
    })
    expect(addRes.ok()).toBeTruthy()
    expect((await addRes.json()).added).toBe(true)

    // ── the added member is told ──
    await expect
      .poll(
        async () => {
          const res = await otherPage.request.get("/api/notifications")
          const body = await res.json()
          return body.notifications.filter(
            (n: { kind: string }) => n.kind === "workspace_member_added"
          ).length
        },
        { message: "the added member should receive exactly one notification" }
      )
      .toBe(1)

    const otherBody = await (await otherPage.request.get("/api/notifications")).json()
    expect(otherBody.unreadCount).toBeGreaterThan(0)
    expect(otherBody.notifications[0].title).toContain("Notify Test")
    expect(otherBody.notifications[0].workspaceId).toBe(workspace.id)

    // ── the actor is NOT told about their own action ──
    const ownerBody = await (await page.request.get("/api/notifications")).json()
    const ownerAdds = ownerBody.notifications.filter(
      (n: { kind: string }) => n.kind === "workspace_member_added"
    )
    expect(ownerAdds).toHaveLength(0)
    expect(ownerId).not.toBe("")

    await otherContext.close()
  })

  test("one user cannot mark another user's notifications read", async (
    { page, context, browser },
    testInfo
  ) => {
    const OTHER = otherUser(testInfo.repeatEachIndex + 100)
    await authAs(page, context)
    const wsRes = await page.request.post("/api/test/workspace", { data: { name: "Scope Test" } })
    const { workspace } = await wsRes.json()

    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await authAs(otherPage, otherContext, OTHER)

    await page.request.post(`/api/workspaces/${workspace.id}/members`, {
      data: { identifier: OTHER.email, role: "member" },
    })

    await expect
      .poll(async () => (await (await otherPage.request.get("/api/notifications")).json()).unreadCount)
      .toBeGreaterThan(0)

    const before = await (await otherPage.request.get("/api/notifications")).json()
    const victimId: string = before.notifications[0].id

    // The owner tries to clear a notification belonging to the other user.
    await page.request.post("/api/notifications", { data: { ids: [victimId] } })

    const after = await (await otherPage.request.get("/api/notifications")).json()
    expect(after.unreadCount).toBe(before.unreadCount)
    expect(after.notifications[0].readAt).toBeNull()

    await otherContext.close()
  })
})

test.describe("notification bell @no-sandbox", () => {
  test("badges unread, opens the panel, and clears on open", async (
    { page, context, browser },
    testInfo
  ) => {
    const BELL_USER = bellUser(testInfo.repeatEachIndex)
    // Produce a real notification for the user who will view the UI.
    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await authAs(ownerPage, ownerContext)
    const wsRes = await ownerPage.request.post("/api/test/workspace", {
      data: { name: "Bell Test" },
    })
    const { workspace } = await wsRes.json()

    await authAs(page, context, BELL_USER)
    await ownerPage.request.post(`/api/workspaces/${workspace.id}/members`, {
      data: { identifier: BELL_USER.email, role: "member" },
    })

    await page.goto("/")

    const bell = page.getByTestId("notification-bell")
    await expect(bell).toBeVisible()

    const badge = page.getByTestId("notification-badge")
    await expect(badge).toBeVisible()

    await bell.click()
    const panel = page.getByTestId("notification-panel")
    await expect(panel).toBeVisible()
    await expect(panel).toContainText("Bell Test")

    // Unmasked on purpose: everything in this panel is deterministic for the
    // duration of the test (the workspace is named by the test, and a
    // notification created seconds ago always renders as "now"), and a shot
    // that masks its own content asserts nothing.
    // maxDiffPixels absorbs antialiasing on the rounded corner — repeat runs
    // differ by ~10 sub-visual pixels there — while still failing on any real
    // change to layout, spacing or colour.
    // The committed baseline is macOS-rendered. Linux draws text differently,
    // so comparing there fails for the platform rather than for a regression —
    // and a red CI nobody trusts is worse than no screenshot in CI. Everything
    // else in this test still runs there; only the pixel diff is local.
    // To enable it in CI, generate a linux baseline with --update-snapshots.
    if (!process.env.CI) {
      await expect(panel).toHaveScreenshot("notification-panel.png", { maxDiffPixels: 40 })
    }

    // Opening the panel is the act of reading it.
    await expect(badge).toBeHidden()

    // Clicking outside closes it.
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await expect(panel).toBeHidden()

    await ownerContext.close()
  })

  test("shows an empty state when there is nothing", async ({ page, context }) => {
    await authAs(page, context)
    await page.goto("/")

    const bell = page.getByTestId("notification-bell")
    await expect(bell).toBeVisible()
    // The owner never notifies themselves, so this user's bell stays empty.
    await expect(page.getByTestId("notification-badge")).toBeHidden()

    await bell.click()
    await expect(page.getByTestId("notification-panel")).toContainText("Nothing yet")
  })

  test("closes on Escape", async ({ page, context }) => {
    await authAs(page, context)
    await page.goto("/")
    await page.getByTestId("notification-bell").click()
    await expect(page.getByTestId("notification-panel")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("notification-panel")).toBeHidden()
  })
})

test.describe("sidebar awaiting-input marker @no-sandbox", () => {
  test("marks a chat that is waiting on you, and not one that is not", async ({
    page,
    context,
  }, testInfo) => {
    // A fresh user per repeat: the sidebar lists every chat this user owns, so
    // a fixed account would accumulate rows across passes.
    await authAs(page, context, {
      email: `marker-${testInfo.repeatEachIndex}@playwright.local`,
      name: "Marker User",
    })

    // The sidebar is workspace-scoped — with none active it shows an empty
    // state instead of any chats, so both the workspace and the chats' binding
    // to it are load-bearing for this test.
    const wsRes = await page.request.post("/api/test/workspace", {
      data: { name: "Marker WS" },
    })
    expect(wsRes.ok()).toBeTruthy()
    const { workspace } = await wsRes.json()

    for (const [displayName, awaitingInput] of [
      ["Waiting On You", true],
      ["All Finished", false],
    ] as const) {
      const res = await page.request.post("/api/test/chat", {
        data: { displayName, awaitingInput, workspaceId: workspace.id },
      })
      expect(res.ok()).toBeTruthy()
      // Assert the binding rather than trusting it: an unbound chat is
      // invisible in a workspace-scoped sidebar, and the DOM assertion below
      // would then fail with "element not found" and no hint why.
      expect((await res.json()).chat.workspaceId).toBe(workspace.id)
    }

    // Same again for the list the sidebar actually reads.
    const listed = await (await page.request.get("/api/chats")).json()
    const mine = (listed.chats ?? listed).filter(
      (c: { workspaceId?: string }) => c.workspaceId === workspace.id
    )
    expect(mine).toHaveLength(2)
    expect(mine.every((c: { messageCount: number }) => c.messageCount > 0)).toBe(true)

    // Activate it the way the app does, before the provider hydrates.
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [
        "switchboard.activeWorkspace",
        JSON.stringify({
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          path: `workspaces/${workspace.slug}`,
          agent: "eliza",
        }),
      ] as const
    )

    await page.goto("/")

    // Both chats render. Each title appears twice — once as a sidebar row and
    // once under "Recent chats" on the home page — so count, rather than
    // toBeVisible, which is ambiguous across the two.
    await expect(page.getByText("Waiting On You", { exact: true })).toHaveCount(2)
    await expect(page.getByText("All Finished", { exact: true })).toHaveCount(2)

    // Only the blocked chat carries the marker. The negative is the assertion
    // that matters: an indicator shown on every row is the same as no
    // indicator at all.
    const marker = page.locator('[title="This chat is waiting on your reply"]')
    await expect(marker).toHaveCount(1)

    // And it sits on the right row. Filtering ancestors by text is not enough
    // — every container up to the sidebar itself holds both titles — so walk
    // up to the nearest ancestor that carries a chat title and read it.
    const markedTitle = await marker.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement
      while (node) {
        const title = node.querySelector(".text-sm.truncate")
        if (title) return title.textContent?.trim() ?? null
        node = node.parentElement
      }
      return null
    })
    expect(markedTitle).toBe("Waiting On You")
  })
})
