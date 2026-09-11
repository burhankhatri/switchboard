import { test, expect } from "@playwright/test"
import { authAsUser } from "./helpers"

/**
 * Opening a workspace from the picker. @no-sandbox
 *
 * Selecting a workspace is localStorage, not a fetch, so when this broke there
 * was no failed request to notice — the card simply did nothing. It broke
 * because HomeView rendered <WorkspaceLauncher /> without onOpen, and the prop
 * was optional, so nothing complained at build time either.
 */
test.describe("workspace picker @no-sandbox", () => {
  test("clicking a workspace opens it", async ({ page, context }, testInfo) => {
    await authAsUser(page, context, {
      email: `opener-${testInfo.repeatEachIndex}@playwright.local`,
      name: "Opener",
    })

    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "Openable WS" } })
    ).json()

    await page.goto("/")

    // The picker card carries the repo path as well as the name, so match on
    // the name alone and take the card.
    const card = page.getByRole("button", { name: /Openable WS/ }).first()
    await expect(card).toBeVisible()
    await card.click()

    // The workspace is now active: the sidebar switcher names it (exact — the
    // home page also renders "Start a new chat in Openable WS"), and the picker
    // heading is gone.
    const switcher = page.getByRole("button", { name: "Openable WS", exact: true })
    await expect(switcher).toBeVisible()
    await expect(page.getByRole("heading", { name: "Pick a workspace" })).toBeHidden()

    // And it survives a reload, which is the whole point of persisting it.
    await page.reload()
    await expect(switcher).toBeVisible()
    expect(workspace.id).toBeTruthy()
  })
})
