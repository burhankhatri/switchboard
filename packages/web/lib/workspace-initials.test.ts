import { describe, expect, it } from "vitest"
import { workspaceInitials } from "./workspace-initials"

describe("workspaceInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(workspaceInitials("GTM-Lead-Engine")).toBe("GL")
    expect(workspaceInitials("design team")).toBe("DT")
  })

  it("uses one letter for a one-word name", () => {
    expect(workspaceInitials("Marketing")).toBe("M")
  })

  it("skips punctuation and falls back when nothing is left", () => {
    expect(workspaceInitials("  --ops__crew ")).toBe("OC")
    expect(workspaceInitials("!!!")).toBe("?")
  })
})
