import { test, expect } from "@playwright/test"
import { authAsUser } from "./helpers"

/**
 * Who can see and join a workspace. @no-sandbox
 *
 * A workspace membership is not a label — it decrypts that workspace's
 * connection secrets into the sandbox on every run. For GTM-Lead-Engine that is
 * a live CRM token and an Instantly API key with ~85 warmed sending domains
 * behind it.
 *
 * So these are the tests that decide whether sign-up can be opened up. Joining
 * used to be self-serve: any authenticated user could POST to a workspace's
 * membership endpoint and take its credentials.
 */

const OUTSIDER = (n: number) => ({
  email: `outsider-${n}@playwright.local`,
  name: "Outsider",
})

test.describe("workspace access @no-sandbox", () => {
  test("a workspace is invisible to someone who is not a member", async (
    { page, context, browser },
    testInfo
  ) => {
    await authAsUser(page, context)
    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "Private Ops" } })
    ).json()

    const outsiderContext = await browser.newContext()
    const outsiderPage = await outsiderContext.newPage()
    await authAsUser(outsiderPage, outsiderContext, OUTSIDER(testInfo.repeatEachIndex))

    const listed = await (await outsiderPage.request.get("/api/workspaces")).json()
    const ids = listed.workspaces.map((w: { id: string }) => w.id)
    expect(ids).not.toContain(workspace.id)

    await outsiderContext.close()
  })

  test("the list never leaks a system prompt to a non-member", async (
    { page, context, browser },
    testInfo
  ) => {
    // systemPrompt describes how the team operates, and was previously returned
    // for every workspace to every signed-in user.
    await authAsUser(page, context)
    await page.request.post("/api/test/workspace", { data: { name: "Prompt Leak" } })

    const outsiderContext = await browser.newContext()
    const outsiderPage = await outsiderContext.newPage()
    await authAsUser(outsiderPage, outsiderContext, OUTSIDER(testInfo.repeatEachIndex + 10))

    const body = await (await outsiderPage.request.get("/api/workspaces")).text()
    expect(body).not.toContain("Prompt Leak")

    await outsiderContext.close()
  })

  test("a stranger cannot join a workspace on their own", async (
    { page, context, browser },
    testInfo
  ) => {
    // The exposure this whole file exists for.
    await authAsUser(page, context)
    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "No Self Join" } })
    ).json()

    const outsiderContext = await browser.newContext()
    const outsiderPage = await outsiderContext.newPage()
    await authAsUser(outsiderPage, outsiderContext, OUTSIDER(testInfo.repeatEachIndex + 20))

    const join = await outsiderPage.request.post(
      `/api/workspaces/${workspace.id}/membership`
    )
    expect(join.status()).toBeGreaterThanOrEqual(400)

    // And the attempt left no membership behind.
    const listed = await (await outsiderPage.request.get("/api/workspaces")).json()
    expect(listed.workspaces.map((w: { id: string }) => w.id)).not.toContain(workspace.id)

    await outsiderContext.close()
  })

  test("an owner can still add someone, and then they see it", async (
    { page, context, browser },
    testInfo
  ) => {
    // The path that must keep working: closing self-serve join must not close
    // the product's actual promise — add a person and it works for them.
    const who = OUTSIDER(testInfo.repeatEachIndex + 30)
    await authAsUser(page, context)
    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "Owner Adds" } })
    ).json()

    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await authAsUser(memberPage, memberContext, who)

    const added = await page.request.post(`/api/workspaces/${workspace.id}/members`, {
      data: { identifier: who.email, role: "member" },
    })
    expect(added.ok()).toBeTruthy()

    const listed = await (await memberPage.request.get("/api/workspaces")).json()
    const found = listed.workspaces.find((w: { id: string }) => w.id === workspace.id)
    expect(found).toBeTruthy()
    expect(found.joined).toBe(true)

    await memberContext.close()
  })

  test("a member who leaves loses visibility again", async (
    { page, context, browser },
    testInfo
  ) => {
    const who = OUTSIDER(testInfo.repeatEachIndex + 40)
    await authAsUser(page, context)
    const { workspace } = await (
      await page.request.post("/api/test/workspace", { data: { name: "Leaves Again" } })
    ).json()

    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await authAsUser(memberPage, memberContext, who)
    await page.request.post(`/api/workspaces/${workspace.id}/members`, {
      data: { identifier: who.email, role: "member" },
    })

    const leave = await memberPage.request.delete(
      `/api/workspaces/${workspace.id}/membership`
    )
    expect(leave.ok()).toBeTruthy()

    const listed = await (await memberPage.request.get("/api/workspaces")).json()
    expect(listed.workspaces.map((w: { id: string }) => w.id)).not.toContain(workspace.id)

    await memberContext.close()
  })
})
