import { describe, it, expect } from "vitest"
import { parseMention } from "./MentionMenu"

describe("parseMention", () => {
  it("opens on a bare @ at the start", () => {
    expect(parseMention("@")).toEqual({ query: "", start: 0 })
  })

  it("opens on @ after a space and captures what follows", () => {
    expect(parseMention("use @sun")).toEqual({ query: "sun", start: 4 })
  })

  it("reports the offset of the @ so a selection replaces the typed token", () => {
    const input = "pull leads with @cr"
    const m = parseMention(input)!
    expect(input.slice(m.start)).toBe("@cr")
  })

  it("does not open inside an email address", () => {
    // The @ has a word character before it, so it is not a mention.
    expect(parseMention("mail jez@gmail")).toBeNull()
  })

  it("does not open once the mention is finished with a space", () => {
    // A trailing space means the token is committed; re-opening the menu there
    // would hijack the arrow keys while someone is typing the rest of a prompt.
    expect(parseMention("use @sunzi ")).toBeNull()
  })

  it("does not open for an @ earlier in the line", () => {
    expect(parseMention("@sunzi then do the thing")).toBeNull()
  })

  it("accepts the characters connection slugs and filenames actually use", () => {
    expect(parseMention("@lead-gen")?.query).toBe("lead-gen")
    expect(parseMention("@run_zip")?.query).toBe("run_zip")
    expect(parseMention("@master.csv")?.query).toBe("master.csv")
  })

  it("returns null for text with no @ at all", () => {
    expect(parseMention("just a normal prompt")).toBeNull()
  })
})
