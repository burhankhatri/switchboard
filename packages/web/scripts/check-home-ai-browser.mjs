// Runs the production home components against a deterministic HTTP fixture.
// No database reset, real credentials, or model calls are involved.
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import assert from "node:assert/strict"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "test-results/home-ai")
await mkdir(out, { recursive: true })
await build({ absWorkingDir: root, entryPoints: ["e2e/fixtures/home-ai.tsx"], outfile: path.join(out, "app.js"), bundle: true, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })
await writeFile(path.join(out, "app.css"), css.css)
const widgets = [], operations = [], clients = new Set(), requests = []
const source = { chatId: "", messageId: "", author: "Wayne", date: "2026-10-28T12:00:00.000Z" }
const insights = [{ id: "issue", key: "sync", title: "CRM sync needs attention", detail: "Wayne and Burhan identified missing records in the latest import.", kind: "issue", status: "open", evidence: [source, { ...source, author: "Burhan" }], updatedAt: source.date }]
const signal = () => { for (const res of clients) res.write(`data: changed\n\n`) }
const widget = (id, headline) => ({ id, key: id, type: "summary", title: "Workspace summary", content: { headline, points: [{ text: "CRM sync needs attention", tone: "warn" }] }, position: 0, updatedAt: new Date().toISOString(), createdVia: "agent", createdBy: null, updatedBy: { id: "u", name: "Burhan" }, source: { job: null, chatId: null }, stale: false })
const server = createServer(async (req, res) => {
  if (req.url.endsWith("/events")) { res.writeHead(200, { "Content-Type": "text/event-stream" }); clients.add(res); res.write("data: changed\n\n"); req.on("close", () => clients.delete(res)); return }
  if (req.url === "/app.js" || req.url === "/app.css") { res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css"); res.end(await readFile(path.join(out, req.url.slice(1)))); return }
  res.setHeader("Content-Type", "application/json")
  if (req.method === "POST") {
    let raw = ""; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests.push(body)
    const kind = body.kind ?? body.action
    const op = { id: `op-${operations.length}`, kind, targetId: body.targetId ?? null, request: ["create", "edit", "edit-insight"].includes(kind) ? body.prompt : null, status: "running", stage: "Reading workspace conversations", sequence: 1, error: null, plan: null, dismissed: [], receipts: [], canManage: true, createdAt: new Date().toISOString() }
    operations.unshift(op)
    if (body.action === "accept") {
      const suggested = operations.find(o => o.id === body.operationId)
      suggested.dismissed.push(body.index)
      op.plan = { changes: [suggested.plan.changes[body.index]], insights: [] }
    }
    res.end(JSON.stringify({ operationId: op.id })); signal()
    setTimeout(() => { op.stage = "Preparing changes"; op.sequence = 2; signal() }, 300)
    setTimeout(() => {
      if (body.prompt?.startsWith("Break")) { Object.assign(op, { status: "failed", stage: "Needs attention", sequence: 3, error: "The agent returned a component that could not be used." }); signal(); return }
      if (body.kind === "suggestions") op.plan = { changes: [{ targetId: "summary", version: widgets[0]?.updatedAt, key: "summary", type: "summary", title: "Workspace summary", content: { headline: "Team priorities and next steps" }, reason: "Reflect the latest team discussion", evidence: [source] }], insights: [] }
      else if (body.kind === "edit-insight") insights[0].detail = "The team is checking missing records."
      else if (body.kind === "edit") widgets[0] = widget("summary", "Updated summary from your instructions")
      else if (body.action === "accept") widgets[0] = widget("summary", "Team priorities and next steps")
      else widgets.push(widget("summary", "A clear picture of the workspace"))
      op.receipts = body.kind === "suggestions" ? [] : [{ id: "summary", title: "Workspace summary" }]
      op.status = "completed"; op.stage = "Up to date"; op.sequence = 3; signal()
    }, 1200)
    return
  }
  if (req.url.endsWith("/home/ai")) return res.end(JSON.stringify({ enabled: true, operations, insights }))
  if (req.url.endsWith("/home")) return res.end(JSON.stringify({ widgets, jobs: [], sharedChats: [], feed: { events: [], nextCursor: null }, since: null }))
  res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const desktop = await browser.newPage({ viewport: { width: 1365, height: 1000 } })
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
  const errors = []; desktop.on("pageerror", e => errors.push(e.message)); mobile.on("pageerror", e => errors.push(e.message))
  operations.push({ id: "op-old", kind: "create", targetId: null, status: "failed", stage: "Needs attention", sequence: 3, error: "An earlier failure", plan: null, dismissed: [], receipts: [], canManage: true, createdAt: source.date })
  await Promise.all([desktop.goto(url), mobile.goto(url)])
  await desktop.getByText("CRM sync needs attention", { exact: true }).first().waitFor()
  assert.equal(await desktop.getByText("An earlier failure").count(), 0, "a failure from before this visit is not shown")
  await desktop.getByRole("button", { name: "Ask agent", exact: true }).nth(1).click()
  const textbox = desktop.getByRole("textbox", { name: "Describe the change" })
  assert.match(await textbox.inputValue(), /Summarise this workspace/)
  await textbox.fill("Summarise the team's most important priorities.")
    const send = desktop.getByRole("button", { name: "Send", exact: true })
    // The popover opens with a zoom, so sizes are only final once it settles.
    await desktop.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)))
    const sendBox = await send.boundingBox(), inputBox = await textbox.boundingBox()
    assert.ok(Math.abs(sendBox.width - inputBox.width) < 2 && sendBox.height >= 44, "Send fills the popover with a touch-sized target")
    const background = () => send.evaluate(el => getComputedStyle(el).backgroundColor)
    const normal = await background()
    await send.hover()
    await desktop.waitForTimeout(200)
    assert.notEqual(await background(), normal, "hover has a distinct primary background")
    await desktop.mouse.down()
    await desktop.waitForTimeout(200)
    await desktop.screenshot({ path: path.join(out, "send-pressed.png") })
    assert.notEqual(await background(), normal, "pressed state remains distinct")
    await desktop.mouse.move(0, 0)
    await desktop.mouse.up()
  await desktop.getByRole("button", { name: "Send", exact: true }).click()
  await desktop.getByText("Reading workspace conversations", { exact: true }).waitFor()
  await desktop.getByText("Updating the home page", { exact: true }).waitFor()
  await desktop.getByText("“Summarise the team's most important priorities.”", { exact: true }).waitFor()
  await desktop.getByText("A clear picture of the workspace").waitFor()
  await mobile.getByText("A clear picture of the workspace").waitFor()
  assert.equal(desktop.url(), url + "/")
  assert.equal(requests[0].prompt, "Summarise the team's most important priorities.")
  await desktop.getByRole("button", { name: "Edit Workspace summary with AI" }).click()
  await textbox.fill("Make the summary shorter and focus on unresolved issues.")
  await desktop.getByRole("button", { name: "Send", exact: true }).click()
  await desktop.getByText("Reading workspace conversations", { exact: true }).first().waitFor()
  await desktop.getByText("Editing “Workspace summary”", { exact: true }).waitFor()
  assert.equal(await desktop.getByText("A clear picture of the workspace").count(), 1)
  await desktop.getByText("Updated summary from your instructions").waitFor()
  await mobile.getByRole("button", { name: "Edit CRM sync needs attention with AI" }).click()
  await mobile.getByRole("textbox", { name: "Describe the change" }).fill("Clarify what the team is checking.")
  await mobile.getByRole("button", { name: "Send", exact: true }).click()
  await desktop.getByText("The team is checking missing records.", { exact: true }).waitFor()
  await desktop.getByRole("button", { name: "Suggestions", exact: true }).click()
  await desktop.getByText("Reflect the latest team discussion").waitFor()
  await desktop.getByText("Preview content", { exact: true }).click()
  await desktop.screenshot({ path: path.join(out, "desktop-suggestions.png"), fullPage: true })
  const accept = desktop.getByRole("button", { name: "Accept", exact: true })
  await accept.hover()
  await desktop.waitForTimeout(250)
  const hovered = await accept.evaluate(el => getComputedStyle(el).backgroundColor)
  const alpha = (c => { const m = c.match(/\/\s*([\d.]+)(%?)\s*\)$/) ?? c.match(/^rgba\([^)]*,\s*([\d.]+)()\)$/); return m ? parseFloat(m[1]) / (m[2] ? 100 : 1) : 1 })(hovered)
  assert.ok(alpha >= 0.8, `hovered Accept keeps a solid primary background behind its text (got ${hovered})`)
  await desktop.screenshot({ path: path.join(out, "accept-hover.png") })
  await accept.click()
  await desktop.getByText("Updating “Workspace summary” from a suggestion", { exact: true }).waitFor()
  await desktop.getByText("Team priorities and next steps", { exact: true }).waitFor()
  await mobile.getByText("Team priorities and next steps", { exact: true }).waitFor()
  assert.equal(widgets.length, 1, "accept updates instead of duplicating")
  await desktop.getByRole("button", { name: "Ask agent", exact: true }).nth(1).click()
  await textbox.fill("Break this run on purpose.")
  await desktop.getByRole("button", { name: "Send", exact: true }).click()
  const failure = desktop.getByRole("alert").filter({ hasText: "AI could not finish" })
  await failure.waitFor()
  assert.match(await failure.innerText(), /could not be used/)
  await desktop.screenshot({ path: path.join(out, "failure.png") })
  await failure.getByRole("button", { name: "Dismiss error" }).click()
  assert.equal(await failure.count(), 0, "the cross removes the failure")
  await desktop.reload()
  await desktop.getByText("CRM sync needs attention", { exact: true }).first().waitFor()
  await desktop.waitForTimeout(500)
  assert.equal(await desktop.getByText("AI could not finish").count(), 0, "a refresh starts without old failures")
  widgets.push({ ...widget("timeline", ""), type: "timeline", title: "Recent milestones", content: { events: [{ date: "28 Oct", title: "Import issue identified", who: "Wayne and Burhan", detail: "Missing records were reported in the latest CRM import.", tone: "warn" }, { date: "27 Oct", title: "Campaign launched", who: "Burhan", tone: "good" }] } }); signal()
  await mobile.getByText("Import issue identified", { exact: true }).waitFor()
  await mobile.getByText("Import issue identified", { exact: true }).scrollIntoViewIfNeeded()
  await mobile.screenshot({ path: path.join(out, "mobile.png"), fullPage: true })
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile must not overflow")
  assert.deepEqual(errors, [])
  console.log("PASS: inline summary, rewritten prompt, live edit, preserved content, suggestions preview/accept, two viewers, proactive findings, mobile timeline, reduced motion; zero browser errors.")
} finally { await browser.close(); for (const res of clients) res.end(); server.closeAllConnections(); server.close() }
