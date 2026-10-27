import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { FileBody, JobBody, NoteBody, StatBody, TableBody, WidgetFooter, amountOf } from "./bodies"
import { statusTone } from "./tone"
import { ActionsBody, FunnelBody, KpisBody, SummaryBody, TimelineBody } from "./visuals"

describe("widget bodies", () => {
  it("shows a note's HTML as text, never as markup", () => {
    // Content is validated as data, but the renderer is the last line: an
    // agent that read a hostile page must not be able to put an <img onerror>
    // in front of a colleague.
    const html = renderToStaticMarkup(
      <NoteBody content={{ markdown: 'Hi <img src=x onerror="alert(1)"> **bold**' }} />
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/)
  })

  it("only links http(s) URLs", () => {
    expect(renderToStaticMarkup(<WidgetFooter link="javascript:alert(1)" />)).toBe("")
    const ok = renderToStaticMarkup(<WidgetFooter link="https://example.com/r" />)
    expect(ok).toContain('href="https://example.com/r"')
    expect(ok).toContain('target="_blank"')
    expect(ok).toContain("noopener")
  })

  it("formats a stat and says its direction in words and an arrow", () => {
    const html = renderToStaticMarkup(
      <StatBody content={{ value: 34200, unit: "leads", change: { value: "+18%", direction: "up" } }} />
    )
    expect(html).toContain((34200).toLocaleString())
    expect(html).toContain("leads")
    expect(html).toContain("+18%")
  })

  it("renders empty table cells as a dash rather than 'null'", () => {
    const html = renderToStaticMarkup(
      <TableBody content={{ columns: ["Company", "Score"], rows: [["Acme", null]] }} />
    )
    expect(html).toContain("Acme")
    expect(html).not.toContain("null")
  })

  it("says a pinned file is gone instead of offering to open it", () => {
    const html = renderToStaticMarkup(
      <FileBody content={{ path: "workspaces/w/leads.csv" }} exists={false} onOpen={vi.fn()} />
    )
    expect(html).toContain("leads.csv has been deleted or moved")
  })

  it("says a pinned job is gone", () => {
    const html = renderToStaticMarkup(
      <JobBody content={{ jobId: "j1" }} job={undefined} onOpenChat={vi.fn()} />
    )
    expect(html).toContain("no longer exists")
  })

  it("hides template comments and renders an image as its alt text", () => {
    // The image rule is the same line as markup: a widget never makes the
    // browser fetch a URL on its own.
    const html = renderToStaticMarkup(
      <NoteBody content={{ markdown: "<!-- for editors -->\n![tracking pixel](https://x.test/p.gif) seen" }} />
    )
    expect(html).not.toContain("for editors")
    expect(html).not.toContain("x.test")
    expect(html).toContain("tracking pixel")
  })

  it("puts a status column in pills and a column of amounts behind bars", () => {
    const html = renderToStaticMarkup(
      <TableBody
        content={{
          columns: ["Campaign", "Status", "Reply %"],
          rows: [
            ["DFW bid ask", "Draft", "1.82%"],
            ["Electricity Bill", "Active", "0.45%"],
            ["Sequence 1", "Completed", "2.80%"],
          ],
        }}
      />
    )
    expect(html).toContain("rounded-full")
    // The 2.80% row is the column's largest, so its bar is full.
    expect(html).toContain("width:100%")
  })

  it("shows a long table's first rows and offers the rest", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`Row ${i}`])
    const html = renderToStaticMarkup(<TableBody content={{ columns: ["Name"], rows }} />)
    expect(html).toContain("Row 7")
    expect(html).not.toContain("Row 8")
    expect(html).toContain("Show all 12 rows")
  })
})

describe("table helpers", () => {
  it("reads amounts the way agents write them", () => {
    expect(amountOf(1178)).toBe(1178)
    expect(amountOf("2.80%")).toBe(2.8)
    expect(amountOf("$1,200")).toBe(1200)
    expect(amountOf("Draft")).toBeNull()
    expect(amountOf("12 Oct")).toBeNull()
  })

  it("reads status words by their stem", () => {
    expect(statusTone("Draft")).toBe("warn")
    expect(statusTone("ACTIVE")).toBe("good")
    expect(statusTone("Paused (manual)")).toBe("warn")
    expect(statusTone("Failed")).toBe("bad")
    expect(statusTone("Completed")).toBeUndefined()
  })
})

describe("visual bodies", () => {
  it("leads a summary with its headline and marks each point's tone in words", () => {
    const html = renderToStaticMarkup(
      <SummaryBody
        content={{
          headline: "Two drafts wait for Wayne.",
          points: [{ text: "62 people ready", tone: "good" }, { text: "No reply yet", tone: "bad" }],
        }}
      />
    )
    expect(html).toContain("Two drafts wait for Wayne.")
    expect(html).toContain('aria-label="Good"')
    expect(html).toContain('aria-label="Problem"')
  })

  it("shows every KPI with its change", () => {
    const html = renderToStaticMarkup(
      <KpisBody
        content={{
          items: [
            { label: "Opportunities", value: 18, change: { value: "+80%", direction: "up" } },
            { label: "Reply rate", value: "1.82%" },
          ],
          asOf: "26 Oct",
        }}
      />
    )
    expect(html).toContain("Opportunities")
    expect(html).toContain("+80%")
    expect(html).toContain("As of 26 Oct")
  })

  it("works out a funnel's conversion between steps", () => {
    const html = renderToStaticMarkup(
      <FunnelBody content={{ steps: [{ label: "Qualified", value: 200 }, { label: "Has email", value: 50 }] }} />
    )
    expect(html).toContain("25% carry on")
  })

  it("shows a timeline's newest events and offers the rest", () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ date: `${i + 1} Oct`, title: `Event ${i}` }))
    const html = renderToStaticMarkup(<TimelineBody content={{ events }} />)
    expect(html).toContain("Event 5")
    expect(html).not.toContain("Event 6")
    expect(html).toContain("Show 3 earlier")
  })

  it("labels each action's urgency in words", () => {
    const html = renderToStaticMarkup(
      <ActionsBody
        content={{ items: [{ title: "Launch the DFW draft", urgency: "now", owner: "Wayne", since: "1 Oct" }] }}
      />
    )
    expect(html).toContain("Now")
    expect(html).toContain("Launch the DFW draft")
    expect(html).toContain("Waiting on Wayne")
  })
})
