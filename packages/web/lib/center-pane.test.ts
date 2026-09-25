import { describe, expect, it } from "vitest"
import { centerPaneFor } from "./center-pane"

describe("centerPaneFor", () => {
  it("shows an opened file on the home page, not just inside a chat", () => {
    // The file takeover used to live in ChatPanel, which the home page never
    // renders — so clicking a skill with no chat open highlighted the row and
    // displayed nothing.
    expect(centerPaneFor({ openFile: "ws/SKILL.md", viewMode: "chat", chatId: null })).toBe("file")
  })

  it("shows an opened file over a chat and over scheduled agents", () => {
    expect(centerPaneFor({ openFile: "ws/a.py", viewMode: "chat", chatId: "c1" })).toBe("file")
    expect(centerPaneFor({ openFile: "ws/a.py", viewMode: "scheduled-jobs", chatId: null })).toBe("file")
  })

  it("falls back to the view underneath once the file is closed", () => {
    expect(centerPaneFor({ openFile: null, viewMode: "scheduled-jobs", chatId: "c1" })).toBe("scheduled-jobs")
    expect(centerPaneFor({ openFile: null, viewMode: "chat", chatId: "c1" })).toBe("chat")
    expect(centerPaneFor({ openFile: null, viewMode: "chat", chatId: null })).toBe("home")
  })
})
