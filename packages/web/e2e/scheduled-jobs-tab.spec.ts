import { test, expect } from "@playwright/test"
import { authAsUser } from "./helpers"

/**
 * Reaching the scheduled agents view from the sidebar. @no-sandbox
 *
 * The view, its list and its create/edit/delete have existed all along, and
 * Sidebar even declared `onOpenScheduledJobs`, `scheduledJobsActive` and
 * `selectedScheduledJob` as props — it just never rendered anything that used
 * them. Optional props, so nothing failed at build time, and the only way into
 * the view was typing /jobs by hand.
 *
 * Same shape of bug as workspace-open.spec.ts, and unreachable-by-typecheck
 * for the same reason, so it gets the same kind of test.
 */
test.describe("scheduled agents tab @no-sandbox", () => {
  test("opens from the sidebar and lists jobs for the workspace", async ({
    page,
    context,
  }, testInfo) => {
    await authAsUser(page, context, {
      email: `scheduler-${testInfo.repeatEachIndex}@playwright.local`,
      name: "Scheduler",
    })

    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "Scheduled WS" } })
    ).json()

    await page.goto("/")
    await page.getByRole("button", { name: /Scheduled WS/ }).first().click()
    await expect(page.getByRole("button", { name: "Scheduled WS", exact: true })).toBeVisible()

    // A job bound to this workspace, so the list has something to show and we
    // are testing the filter as well as the route.
    const created = await page.request.post("/api/scheduled-jobs", {
      data: {
        name: "Weekly campaign audit",
        prompt: "Run the audit and report what changed.",
        workspaceId: workspace.id,
        intervalMinutes: 10080,
      },
    })
    expect(created.ok()).toBeTruthy()

    await page.getByRole("button", { name: "Scheduled", exact: true }).click()

    await expect(page).toHaveURL(/\/jobs$/)
    // Exact: Next's route announcer also renders "Scheduled Agents · Shared Agents".
    await expect(page.getByText("Scheduled Agents", { exact: true })).toBeVisible()
    // Scoped to the table: the job name also appears in the sidebar.
    const list = page.getByRole("table")
    await expect(list.getByText("Weekly campaign audit")).toBeVisible()

    // The create affordance is the other half of "a tab where we can do all
    // of this" — a list you cannot add to is a report.
    await expect(page.getByRole("button", { name: "New Job" })).toBeVisible()

    // And it survives a reload, because the URL is real navigation rather
    // than view state that evaporates.
    await page.reload()
    await expect(page.getByRole("table").getByText("Weekly campaign audit")).toBeVisible()
  })
})
