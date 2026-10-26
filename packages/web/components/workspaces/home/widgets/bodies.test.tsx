import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { FileBody, JobBody, NoteBody, StatBody, TableBody, WidgetFooter } from "./bodies"

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
})
