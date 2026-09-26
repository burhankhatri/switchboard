import { describe, it, expect } from "vitest"
import { anchoredPanelPosition, menuPosition } from "./anchored-panel"

describe("anchoredPanelPosition", () => {
  it("sits just below the button, aligned to its left edge", () => {
    const pos = anchoredPanelPosition({
      anchor: { left: 40, bottom: 60 },
      viewportWidth: 1440,
      panelWidth: 320,
    })
    expect(pos).toEqual({ top: 68, left: 40 })
  })

  it("pulls back from the right edge instead of running off screen", () => {
    // A bell near the right of a narrow window is the normal case, not an edge
    // case — the panel is 320px and the sidebar is ~256px.
    const pos = anchoredPanelPosition({
      anchor: { left: 1300, bottom: 60 },
      viewportWidth: 1440,
      panelWidth: 320,
    })
    expect(pos.left).toBe(1440 - 320 - 8)
    expect(pos.left + 320).toBeLessThanOrEqual(1440)
  })

  it("never goes past the left edge", () => {
    const pos = anchoredPanelPosition({
      anchor: { left: -50, bottom: 60 },
      viewportWidth: 1440,
      panelWidth: 320,
    })
    expect(pos.left).toBe(8)
  })

  it("keeps the panel on screen when it is wider than the viewport", () => {
    // Clamping order matters: applying the right-edge clamp last would push
    // left negative and hide the start of every row.
    const pos = anchoredPanelPosition({
      anchor: { left: 10, bottom: 40 },
      viewportWidth: 300,
      panelWidth: 320,
    })
    expect(pos.left).toBe(8)
  })
})

describe("menuPosition", () => {
  const viewport = { width: 1440, height: 900 }
  const menu = { width: 200, height: 160 }
  // The Files panel's Add button: top right of a 300px-wide sidebar.
  const addButton = { top: 30, bottom: 58, left: 236, right: 290 }

  it("hangs below the trigger, lined up with its right edge", () => {
    expect(menuPosition({ anchor: addButton, menu, viewport, placement: "below", align: "right" })).toEqual({
      top: 64,
      left: 90,
    })
  })

  it("flips above when there is no room below", () => {
    const low = { top: 800, bottom: 828, left: 20, right: 60 }
    expect(menuPosition({ anchor: low, menu, viewport, placement: "below", align: "left" }).top).toBe(634)
  })

  it("opens beside the trigger, out over the main pane, so the list it belongs to stays visible", () => {
    // Hanging below the Add button covered the file tree it was adding to.
    expect(menuPosition({ anchor: addButton, menu, viewport, placement: "right", align: "left" })).toEqual({
      top: 30,
      left: 298,
    })
  })

  it("keeps a side menu on screen at the bottom of the window", () => {
    const low = { top: 850, bottom: 878, left: 236, right: 290 }
    expect(menuPosition({ anchor: low, menu, viewport, placement: "right", align: "left" }).top).toBe(732)
  })

  it("opens a side menu to the left when there is no room on the right", () => {
    const edge = { top: 30, bottom: 58, left: 1300, right: 1380 }
    expect(menuPosition({ anchor: edge, menu, viewport, placement: "right", align: "left" }).left).toBe(1092)
  })
})
