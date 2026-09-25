import { test, expect, type Page, type BrowserContext, type TestInfo, type Request } from "@playwright/test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { authAsUser } from "./helpers"

/**
 * Getting files into a workspace. @no-sandbox
 *
 * Wayne hit "larger than 256KB" uploading an ordinary file; a dropped folder
 * was read as one unreadable file; and the single-file path read everything as
 * text, which would have turned a PDF into noise. Every upload now goes through
 * the binary-safe import route in request-sized batches.
 *
 * E2E has no GitHub token, so the commit itself fails here — these assert what
 * the browser actually sends, which is where every one of those bugs lived.
 */

async function openFilesPanel(page: Page, context: BrowserContext, testInfo: TestInfo) {
  await authAsUser(page, context, {
    email: `files-${testInfo.testId}-${testInfo.repeatEachIndex}@playwright.local`,
    name: "Files User",
  })
  const { workspace } = await (
    await page.request.post("/api/test/workspace", { data: { name: "Files WS" } })
  ).json()
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
  await page.getByRole("tab", { name: "Files" }).click()
  return workspace as { id: string }
}

const isImport = (workspaceId: string) => (r: Request) =>
  r.method() === "POST" && r.url().endsWith(`/api/workspaces/${workspaceId}/import`)

type ImportBody = { files: { relativePath: string; contentBase64: string }[] }

async function chooseFromAddMenu(page: Page, item: "Upload files…" | "Upload folder…") {
  await page.getByRole("button", { name: "Add files or folders" }).click()
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("menuitem", { name: item }).click()
  return chooser
}

/** Bytes a text round trip would mangle: NULs, high bytes, invalid UTF-8. */
function binary(size: number): Buffer {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = (i * 131 + 7) % 256
  return buf
}

test.describe("workspace files @no-sandbox", () => {
  test("uploads a 1MB binary file intact instead of refusing it", async ({ page, context }, testInfo) => {
    const workspace = await openFilesPanel(page, context, testInfo)
    const bytes = binary(1024 * 1024)

    const sent = page.waitForRequest(isImport(workspace.id))
    const chooser = await chooseFromAddMenu(page, "Upload files…")
    await chooser.setFiles({ name: "deck.pdf", mimeType: "application/pdf", buffer: bytes })

    const body = (await sent).postDataJSON() as ImportBody
    expect(body.files.map((f) => f.relativePath)).toEqual(["deck.pdf"])
    expect(Buffer.from(body.files[0].contentBase64, "base64").equals(bytes)).toBe(true)
    await expect(page.getByText(/larger than/)).toHaveCount(0)
  })

  test("uploads a picked folder with its structure", async ({ page, context }, testInfo) => {
    const workspace = await openFilesPanel(page, context, testInfo)
    const root = mkdtempSync(path.join(tmpdir(), "ws-upload-"))
    const folder = path.join(root, "campaign")
    mkdirSync(path.join(folder, "data"), { recursive: true })
    writeFileSync(path.join(folder, "brief.md"), "# Brief")
    writeFileSync(path.join(folder, "data", "leads.csv"), "name,email")

    const sent = page.waitForRequest(isImport(workspace.id))
    const chooser = await chooseFromAddMenu(page, "Upload folder…")
    await chooser.setFiles(folder)

    const body = (await sent).postDataJSON() as ImportBody
    expect(body.files.map((f) => f.relativePath).sort()).toEqual(["campaign/brief.md", "campaign/data/leads.csv"])
  })

  test("uploads files dropped onto the panel together", async ({ page, context }, testInfo) => {
    const workspace = await openFilesPanel(page, context, testInfo)
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(["alpha"], "a.txt", { type: "text/plain" }))
      dt.items.add(new File(["beta"], "b.txt", { type: "text/plain" }))
      return dt
    })

    const sent = page.waitForRequest(isImport(workspace.id))
    // The drop zone is the whole Files panel below the tabs; events are sent
    // to it directly because a synthetic event does not travel down the tree.
    const zone = page.getByRole("tabpanel", { name: "Files" }).getByTestId("files-drop-zone")
    await zone.dispatchEvent("dragenter", { dataTransfer })
    await zone.dispatchEvent("dragover", { dataTransfer })
    await zone.dispatchEvent("drop", { dataTransfer })

    const body = (await sent).postDataJSON() as ImportBody
    expect(body.files.map((f) => f.relativePath).sort()).toEqual(["a.txt", "b.txt"])
  })

  test("splits an upload no single request could carry", async ({ page, context }, testInfo) => {
    const workspace = await openFilesPanel(page, context, testInfo)
    const twoMB = 2 * 1024 * 1024

    const sent = page.waitForRequest(isImport(workspace.id))
    const chooser = await chooseFromAddMenu(page, "Upload files…")
    await chooser.setFiles([
      { name: "one.csv", mimeType: "text/csv", buffer: binary(twoMB) },
      { name: "two.csv", mimeType: "text/csv", buffer: binary(twoMB) },
    ])

    // Together they are over what one request carries, so the first request
    // holds one file rather than both.
    const body = (await sent).postDataJSON() as ImportBody
    expect(body.files).toHaveLength(1)
  })

  test("names a file that is too big and does not send it", async ({ page, context }, testInfo) => {
    const workspace = await openFilesPanel(page, context, testInfo)
    const imports: string[] = []
    page.on("request", (r) => {
      if (isImport(workspace.id)(r)) imports.push(r.url())
    })

    const chooser = await chooseFromAddMenu(page, "Upload files…")
    await chooser.setFiles({ name: "video.csv", mimeType: "text/csv", buffer: binary(4 * 1024 * 1024) })

    await expect(page.getByText("video.csv — larger than 3 MB")).toBeVisible()
    expect(imports).toHaveLength(0)
  })
})

test.describe("starting a chat @no-sandbox", () => {
  test("the home screen's new chat is a clear, full-size action", async ({ page, context }, testInfo) => {
    await openFilesPanel(page, context, testInfo)
    const start = page.getByRole("button", { name: /Start a new chat/ })
    await expect(start).toBeVisible()
    const box = (await start.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(64)
  })

  test("the chats panel labels its new chat button", async ({ page, context }, testInfo) => {
    await openFilesPanel(page, context, testInfo)
    await page.getByRole("tab", { name: "Chats" }).click()
    const newChat = page.getByRole("tabpanel", { name: "Chats" }).getByRole("button", { name: "New chat" })
    await expect(newChat).toHaveText(/New chat/)
  })
})
