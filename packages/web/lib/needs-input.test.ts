import { describe, it, expect } from "vitest"
import { NEEDS_INPUT_MARKER, extractNeedsInput } from "./needs-input"

describe("extractNeedsInput", () => {
  it("detects the marker and reports the turn as blocked", () => {
    const { needsInput } = extractNeedsInput(
      `1. Which campaign?\n2. Draft or active?\n\n${NEEDS_INPUT_MARKER}`
    )
    expect(needsInput).toBe(true)
  })

  it("removes the marker from the content", () => {
    const { content } = extractNeedsInput(
      `1. Which campaign?\n\n${NEEDS_INPUT_MARKER}`
    )
    expect(content).not.toContain("needs-input")
    expect(content).toContain("1. Which campaign?")
  })

  it("leaves no trailing whitespace where the marker was", () => {
    const { content } = extractNeedsInput(`Question?\n\n${NEEDS_INPUT_MARKER}\n`)
    expect(content).toBe("Question?")
  })

  it("reports a normal turn as not blocked and returns it unchanged", () => {
    const original = "Done. I pushed the change and the tests pass."
    const { content, needsInput } = extractNeedsInput(original)
    expect(needsInput).toBe(false)
    expect(content).toBe(original)
  })

  it("does not fire on prose that merely ends in a question", () => {
    // The whole reason for a marker rather than question-detection: an agent
    // that finishes work and asks "want me to keep going?" is not blocked.
    const { needsInput } = extractNeedsInput(
      "I pushed it. Want me to keep going with the next phase?"
    )
    expect(needsInput).toBe(false)
  })

  it("tolerates whitespace inside the marker", () => {
    // Models reproduce a literal inconsistently; a strict match would silently
    // leave the marker visible AND fail to flag the turn.
    const { content, needsInput } = extractNeedsInput("Q?\n\n<!--  needs-input  -->")
    expect(needsInput).toBe(true)
    expect(content).toBe("Q?")
  })

  it("removes every occurrence, not just the first", () => {
    const { content } = extractNeedsInput(
      `${NEEDS_INPUT_MARKER}\nQ?\n${NEEDS_INPUT_MARKER}`
    )
    expect(content).not.toContain("needs-input")
    expect(content).toBe("Q?")
  })

  it("handles empty and undefined content", () => {
    expect(extractNeedsInput("")).toEqual({ content: "", needsInput: false })
    expect(extractNeedsInput(undefined)).toEqual({
      content: "",
      needsInput: false,
    })
  })

  it("does not leave an empty message when the marker is the whole content", () => {
    // If the agent emits only the marker, the stored message would be blank.
    // Better to keep the turn flagged and let the content be empty than to
    // render an empty bubble with no explanation.
    const { content, needsInput } = extractNeedsInput(NEEDS_INPUT_MARKER)
    expect(needsInput).toBe(true)
    expect(content).toBe("")
  })

  it("is an HTML comment, so a missed strip renders as nothing", () => {
    // react-markdown runs without rehype-raw, which drops HTML outright. This
    // is the fallback for the case where some path forgets to strip.
    expect(NEEDS_INPUT_MARKER.startsWith("<!--")).toBe(true)
    expect(NEEDS_INPUT_MARKER.endsWith("-->")).toBe(true)
  })
})
