import { describe, it, expect } from "vitest"
import { anchoredPanelPosition } from "./anchored-panel"

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
