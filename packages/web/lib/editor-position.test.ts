import { describe, expect, it } from "vitest"
import { cursorPosition, lineCount } from "./editor-position"

describe("cursorPosition", () => {
  const text = "first\nsecond line\n\nfourth"

  it("reports lines and columns from one, like every editor's status bar", () => {
    expect(cursorPosition(text, 0)).toEqual({ line: 1, column: 1 })
    expect(cursorPosition(text, 6)).toEqual({ line: 2, column: 1 })
    expect(cursorPosition(text, 12)).toEqual({ line: 2, column: 7 })
    expect(cursorPosition(text, text.length)).toEqual({ line: 4, column: 7 })
  })
})

describe("lineCount", () => {
  it("counts the empty last line a trailing newline leaves", () => {
    expect(lineCount("")).toBe(1)
    expect(lineCount("a")).toBe(1)
    expect(lineCount("a\n")).toBe(2)
    expect(lineCount("a\nb\nc")).toBe(3)
  })
})
