import { describe, it, expect } from "vitest"
import { findMarkdownTable, findHeadlineNumber, pinProposals } from "./pin-detect"
import { validateWidgetContent } from "./widgets"

const reply = `Here are the top installers I found.

### Solar installers in Austin

| Company | Reviews | **Rating** |
|---|---:|---|
| Sunrise Solar | 1,204 | 4.8 |
| Lone Star \\| Energy | 87 | — |

Want me to add them to HubSpot?`

describe("findMarkdownTable", () => {
  it("reads the first table, its title, and numbers as numbers", () => {
    const t = findMarkdownTable(reply)!
    expect(t.title).toBe("Solar installers in Austin")
    expect(t.columns).toEqual(["Company", "Reviews", "Rating"])
    expect(t.rows).toEqual([
      ["Sunrise Solar", 1204, 4.8],
      ["Lone Star | Energy", 87, null],
    ])
  })

  it("finds nothing in prose", () => {
    expect(findMarkdownTable("No table here | just a pipe")).toBeNull()
  })
})

describe("findHeadlineNumber", () => {
  it("turns a one-number answer into a stat", () => {
    expect(findHeadlineNumber("**342** new leads this week.")).toEqual({
      value: 342,
      note: "new leads this week",
    })
  })

  it("keeps a formatted figure as text", () => {
    expect(findHeadlineNumber("Spend so far: $1,200")).toEqual({ value: "$1,200", note: "Spend so far" })
  })

  it("declines anything with more than one number or too much text", () => {
    expect(findHeadlineNumber("12 leads from 3 cities")).toBeNull()
    expect(findHeadlineNumber(`42 ${"words ".repeat(40)}`)).toBeNull()
  })
})

describe("pinProposals", () => {
  it("offers the table first and always a note", () => {
    expect(pinProposals(reply).map((p) => p.type)).toEqual(["table", "note"])
  })

  it("titles a stat with what the number counts", () => {
    expect(pinProposals("342 new leads this week.")[0]).toEqual({
      type: "stat",
      title: "New leads this week",
      content: { value: 342 },
    })
  })

  it("produces content the server will accept", () => {
    for (const text of [reply, "342 new leads this week.", "Just a sentence."]) {
      for (const p of pinProposals(text)) {
        const r = validateWidgetContent(p.type, p.content)
        expect(r.ok, `${p.type}: ${r.ok ? "" : r.error}`).toBe(true)
      }
    }
  })
})
