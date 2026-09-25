import { describe, expect, it } from "vitest"
import { SIDEBAR_CATEGORIES, parseSidebarCategory, parseSidebarCollapsed } from "./sidebar-category"

describe("parseSidebarCategory", () => {
  it("restores every category the rail offers", () => {
    for (const category of SIDEBAR_CATEGORIES) {
      expect(parseSidebarCategory(category)).toBe(category)
    }
  })

  it("falls back to chats when nothing was saved", () => {
    expect(parseSidebarCategory(null)).toBe("chats")
  })

  it("falls back to chats for a value a later build no longer offers", () => {
    expect(parseSidebarCategory("scheduled")).toBe("chats")
  })
})

describe("parseSidebarCollapsed", () => {
  it("is collapsed only when that was saved", () => {
    expect(parseSidebarCollapsed("true")).toBe(true)
    expect(parseSidebarCollapsed("false")).toBe(false)
    expect(parseSidebarCollapsed(null)).toBe(false)
  })
})
