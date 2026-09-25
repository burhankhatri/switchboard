import { test, expect, type Page, type BrowserContext, type TestInfo } from "@playwright/test"
import { authAsUser } from "./helpers"

/**
 * The sidebar as a rail of categories. @no-sandbox
 *
 * It used to stack chats, skills, files, connections and runs in one column
 * with two scroll regions: the chat list capped at 38vh, everything else
 * sharing what was left. Whichever section you needed was the one cut off.
 * Now a rail picks one category and that category owns the whole panel.
 */

interface SeedChat {
  displayName: string
  awaitingInput?: boolean
}

async function openWorkspace(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  chats: SeedChat[] = []
) {
  // A fresh user per test and repeat: the chat list is per user, so a shared
  // account would accumulate rows across runs.
  await authAsUser(page, context, {
    email: `rail-${testInfo.testId}-${testInfo.repeatEachIndex}@playwright.local`,
    name: "Rail User",
  })
  const { workspace } = await (
    await page.request.post("/api/test/workspace", { data: { name: "Rail WS" } })
  ).json()

  for (const chat of chats) {
    const res = await page.request.post("/api/test/chat", {
      data: { ...chat, workspaceId: workspace.id },
    })
    expect(res.ok()).toBeTruthy()
  }

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
  return workspace as { id: string; slug: string; name: string }
}

const numbered = (n: number): SeedChat[] =>
  Array.from({ length: n }, (_, i) => ({ displayName: `Rail chat ${String(i + 1).padStart(2, "0")}` }))

test.describe("sidebar rail @no-sandbox", () => {
  test("each category takes over the whole panel", async ({ page, context }, testInfo) => {
    await openWorkspace(page, context, testInfo, numbered(3))
    await page.goto("/")

    for (const name of ["Skills", "Files", "Connections", "Runs", "Chats"]) {
      const tab = page.getByRole("tab", { name })
      await tab.click()
      await expect(tab).toHaveAttribute("aria-selected", "true")
      // Exact: the Runs panel also has a "Recent runs" section heading.
      await expect(
        page.getByRole("tabpanel", { name }).getByRole("heading", { name, exact: true })
      ).toBeVisible()
    }

    // One category at a time: the chat rows leave with the Chats panel.
    await page.getByRole("tab", { name: "Skills" }).click()
    await expect(page.getByRole("tabpanel").getByTestId("chat-item")).toHaveCount(0)
  })

  test("a long chat list keeps its last chat reachable", async ({ page, context }, testInfo) => {
    await openWorkspace(page, context, testInfo, numbered(40))
    await page.goto("/")

    const panel = page.getByRole("tabpanel", { name: "Chats" })
    const rows = panel.getByTestId("chat-item")
    await expect(rows).toHaveCount(40)

    // The panel owns the column instead of a 38vh slice of it.
    const viewport = page.viewportSize()!
    const box = (await panel.boundingBox())!
    expect(box.height).toBeGreaterThan(viewport.height * 0.7)

    const last = rows.last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
  })

  test("remembers the open category and the collapse across reloads", async (
    { page, context },
    testInfo
  ) => {
    await openWorkspace(page, context, testInfo)
    await page.goto("/")

    await page.getByRole("tab", { name: "Skills" }).click()
    await page.reload()
    await expect(page.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true")

    await page.getByRole("button", { name: "Collapse sidebar" }).click()
    await expect(page.getByRole("tabpanel")).toBeHidden()
    await page.reload()
    await expect(page.getByRole("tab", { name: "Chats" })).toBeVisible()
    await expect(page.getByRole("tabpanel")).toBeHidden()

    // Picking a category from the bare rail brings the panel back.
    await page.getByRole("tab", { name: "Chats" }).click()
    await expect(page.getByRole("tabpanel", { name: "Chats" })).toBeVisible()
  })

  test("flags chats waiting on you on the rail and lists them first", async (
    { page, context },
    testInfo
  ) => {
    const workspace = await openWorkspace(page, context, testInfo, [{ displayName: "All Finished" }])
    await page.goto("/")

    const badge = page.getByTestId("rail-badge-chats")
    await expect(page.getByRole("tabpanel", { name: "Chats" }).getByTestId("chat-item")).toHaveCount(1)
    await expect(badge).toBeHidden()

    const res = await page.request.post("/api/test/chat", {
      data: { displayName: "Waiting On You", awaitingInput: true, workspaceId: workspace.id },
    })
    expect(res.ok()).toBeTruthy()
    await page.reload()

    await expect(badge).toBeVisible()
    // Visible from any category — that is the point of putting it on the rail.
    await page.getByRole("tab", { name: "Files" }).click()
    await expect(badge).toBeVisible()

    await page.getByRole("tab", { name: "Chats" }).click()
    const panel = page.getByRole("tabpanel", { name: "Chats" })
    await expect(panel.getByRole("heading", { name: "Needs you" })).toBeVisible()
    await expect(panel.getByTestId("chat-item").first()).toContainText("Waiting On You")
  })

  test("lists files only once Files is opened", async ({ page, context }, testInfo) => {
    const workspace = await openWorkspace(page, context, testInfo)
    const filesUrl = `/api/workspaces/${workspace.id}/files`
    const listings: string[] = []
    page.on("request", (r) => {
      if (r.url().includes(filesUrl)) listings.push(r.url())
    })

    await page.goto("/")
    await expect(page.getByRole("tabpanel", { name: "Chats" })).toBeVisible()
    // Long enough for anything fired on load to have been sent. The listing is
    // a GitHub round trip, so it must wait until someone asks for it.
    await page.waitForTimeout(1500)
    expect(listings).toHaveLength(0)

    const listing = page.waitForRequest((r) => r.url().includes(filesUrl))
    await page.getByRole("tab", { name: "Files" }).click()
    await listing
  })

  test("the mobile drawer switches categories the same way", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWorkspace(page, context, testInfo, numbered(2))
    await page.goto("/")

    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("tab", { name: "Skills" }).click()
    await expect(
      page.getByRole("tabpanel", { name: "Skills" }).getByRole("heading", { name: "Skills" })
    ).toBeVisible()
  })
})
