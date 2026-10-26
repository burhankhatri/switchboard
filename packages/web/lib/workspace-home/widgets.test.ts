import { describe, it, expect } from "vitest"
import {
  validateWidgetContent,
  validateTitle,
  validateKey,
  fileWidgetPathAllowed,
  MAX_CONTENT_BYTES,
  MAX_TABLE_ROWS,
} from "./widgets"

const ok = (type: string, content: unknown) => {
  const r = validateWidgetContent(type, content)
  if (!r.ok) throw new Error(r.error)
  return r.value.content
}
const err = (type: string, content: unknown) => {
  const r = validateWidgetContent(type, content)
  if (r.ok) throw new Error("expected a rejection")
  return r.error
}

describe("validateWidgetContent", () => {
  it("rejects an unknown type", () => {
    expect(err("html", { body: "<script>" })).toMatch(/type must be one of/)
  })

  it("accepts each type in its documented shape", () => {
    expect(ok("stat", { value: 342, change: { value: "+18%", direction: "up" } })).toBeTruthy()
    expect(ok("table", { columns: ["Company", "City"], rows: [["Acme", "Austin"]] })).toBeTruthy()
    expect(
      ok("chart", { kind: "line", labels: ["W1", "W2"], series: [{ name: "Leads", values: [10, null] }] })
    ).toBeTruthy()
    expect(ok("file", { path: "workspaces/leads/out/leads.xlsx" })).toBeTruthy()
    expect(ok("job", { jobId: "cjob123" })).toBeTruthy()
    expect(ok("note", { markdown: "Campaign B paused until **Nov 3**" })).toBeTruthy()
  })

  it("refuses fields the type does not define", () => {
    // Unknown keys are where markup would hide: { html: "..." } must not be
    // stored just because the renderer would ignore it today.
    expect(err("note", { markdown: "x", html: "<img src=x onerror=alert(1)>" })).toMatch(/Unrecognized key/)
  })

  it("only allows http(s) links", () => {
    expect(err("stat", { value: 1, link: "javascript:alert(1)" })).toMatch(/http or https/)
    expect(err("stat", { value: 1, link: "data:text/html,hi" })).toMatch(/http or https/)
    expect(ok("stat", { value: 1, link: "https://example.com/report" })).toBeTruthy()
  })

  it("caps table rows and requires every row to match the columns", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ["a"])
    expect(err("table", { columns: ["A"], rows })).toMatch(/rows/)
    expect(err("table", { columns: ["A", "B"], rows: [["only one"]] })).toMatch(/Row 1 has 1 cells/)
  })

  it("caps chart size and requires values to line up with labels", () => {
    const labels = Array.from({ length: 101 }, (_, i) => `d${i}`)
    const series = Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, values: labels.map(() => 1) }))
    expect(err("chart", { kind: "bar", labels, series })).toMatch(/At most 500 points/)
    expect(
      err("chart", { kind: "bar", labels: ["a", "b"], series: [{ name: "x", values: [1] }] })
    ).toMatch(/has 1 values/)
  })

  it("enforces the byte limit", () => {
    const markdown = "x".repeat(8000)
    // A single note is within limits; the cap is exercised through a table
    // that is long in cells rather than rows.
    expect(ok("note", { markdown })).toBeTruthy()
    const wide = {
      columns: Array.from({ length: 12 }, (_, i) => `c${i}`),
      rows: Array.from({ length: 50 }, () => Array.from({ length: 12 }, () => "y".repeat(300))),
    }
    expect(err("table", wide)).toMatch(new RegExp(`limit is ${MAX_CONTENT_BYTES}`))
  })
})

describe("visual types", () => {
  it("accepts each in its documented shape", () => {
    expect(
      ok("summary", {
        headline: "Two draft campaigns are waiting for Wayne to launch.",
        points: [{ text: "62 people ready to email", tone: "good" }, { text: "No reply yet" }],
        asOf: "26 Oct",
      })
    ).toBeTruthy()
    expect(
      ok("kpis", {
        items: [
          { label: "Opportunities", value: 18, change: { value: "+80%", direction: "up" } },
          { label: "Reply rate", value: "1.82%", hint: "Best active campaign" },
        ],
      })
    ).toBeTruthy()
    expect(
      ok("funnel", { steps: [{ label: "Qualified", value: 1620 }, { label: "Has email", value: 62 }] })
    ).toBeTruthy()
    expect(
      ok("timeline", { events: [{ date: "25 Sep", title: "22 leads pushed", who: "Burhan", tone: "good" }] })
    ).toBeTruthy()
  })

  it("defaults an action's urgency, so the agent can leave it out", () => {
    expect(ok("actions", { items: [{ title: "Review the DFW draft" }] })).toEqual({
      items: [{ title: "Review the DFW draft", urgency: "soon" }],
    })
  })

  it("keeps their text short", () => {
    expect(err("summary", { headline: "x".repeat(241) })).toMatch(/headline/)
    expect(err("timeline", { events: [{ date: "1 Oct", title: "y".repeat(101) }] })).toMatch(/title/)
    expect(err("kpis", { items: [] })).toMatch(/items/)
    expect(err("funnel", { steps: [{ label: "Only one", value: 3 }] })).toMatch(/steps/)
  })

  it("rejects a tone or urgency outside the set", () => {
    expect(err("summary", { headline: "h", points: [{ text: "t", tone: "red" }] })).toMatch(/tone/)
    expect(err("actions", { items: [{ title: "t", urgency: "asap" }] })).toMatch(/urgency/)
  })
})

describe("titles and keys", () => {
  it("requires a title", () => {
    expect(validateTitle("  ").ok).toBe(false)
    expect(validateTitle("Leads this week")).toEqual({ ok: true, value: "Leads this week" })
  })

  it("treats a missing key as none and rejects a sloppy one", () => {
    expect(validateKey(undefined)).toEqual({ ok: true, value: null })
    expect(validateKey("weekly-leads")).toEqual({ ok: true, value: "weekly-leads" })
    expect(validateKey("Weekly Leads").ok).toBe(false)
  })
})

describe("fileWidgetPathAllowed", () => {
  it("allows files inside the workspace folder only", () => {
    expect(fileWidgetPathAllowed("workspaces/leads/out.csv", "workspaces/leads")).toBe(true)
    expect(fileWidgetPathAllowed("workspaces/other/out.csv", "workspaces/leads")).toBe(false)
    expect(fileWidgetPathAllowed("workspaces/leads/../other/x", "workspaces/leads")).toBe(false)
    expect(fileWidgetPathAllowed("workspaces/leadsX/x", "workspaces/leads")).toBe(false)
  })
})
