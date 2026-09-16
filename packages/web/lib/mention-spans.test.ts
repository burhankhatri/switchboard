import { describe, it, expect } from "vitest"
import { findCommittedMentionSpans } from "./mention-spans"

describe("findCommittedMentionSpans", () => {
  const tokens = ["my-api", "scripts/seed-leads.json", "scripts"]

  it("highlights a committed file mention", () => {
    const text = "update @scripts/seed-leads.json please"
    expect(findCommittedMentionSpans(text, tokens)).toEqual([
      { start: 7, end: 31 },
    ])
  })

  it("prefers the longest matching token", () => {
    const text = "use @scripts/seed-leads.json"
    expect(findCommittedMentionSpans(text, tokens)).toEqual([
      { start: 4, end: 28 },
    ])
  })

  it("does not highlight a partial token still being typed", () => {
    expect(findCommittedMentionSpans("edit @scri", tokens)).toEqual([])
  })

  it("does not highlight unknown tokens", () => {
    expect(findCommittedMentionSpans("edit @unknown-file ", tokens)).toEqual([])
  })

  it("highlights multiple mentions", () => {
    const text = "@my-api then @scripts "
    expect(findCommittedMentionSpans(text, tokens)).toEqual([
      { start: 0, end: 7 },
      { start: 13, end: 21 },
    ])
  })
})
