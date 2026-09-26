/**
 * Where to put a panel anchored under a button, in viewport coordinates.
 *
 * Split out because the panel has to render in a portal: the sidebar sets
 * `backdrop-blur-xl`, and backdrop-filter creates a stacking context, so a
 * child's z-index is confined to the sidebar no matter how high it goes — the
 * main content painted straight over the notification panel. Escaping that
 * means leaving the sidebar's DOM entirely and positioning by hand.
 */

export interface AnchorRect {
  left: number
  bottom: number
}

export interface PanelPosition {
  top: number
  left: number
}

export function anchoredPanelPosition({
  anchor,
  viewportWidth,
  panelWidth,
  gap = 8,
  margin = 8,
}: {
  anchor: AnchorRect
  viewportWidth: number
  panelWidth: number
  /** Space between the button and the panel. */
  gap?: number
  /** Minimum distance from the viewport edge. */
  margin?: number
}): PanelPosition {
  // Left-aligned with the button, so the panel opens across the main content
  // rather than back over a sidebar too narrow to hold it.
  let left = anchor.left

  // Clamp to the viewport. A panel that runs off the right edge is unreachable
  // and, in a collapsed or narrow window, that is the normal case rather than
  // an edge case.
  const maxLeft = viewportWidth - panelWidth - margin
  if (left > maxLeft) left = maxLeft
  if (left < margin) left = margin

  return { top: anchor.bottom + gap, left }
}

export interface MenuPlacement {
  anchor: { top: number; bottom: number; left: number; right: number }
  menu: { width: number; height: number }
  viewport: { width: number; height: number }
  /**
   * above: composer menus — the input is pinned to the bottom of the window.
   * below: sidebar row menus.
   * right: beside the trigger, for menus that would otherwise cover the list
   * they act on.
   */
  placement: "above" | "below" | "right"
  /** Which edge of the anchor an above/below menu lines up with. */
  align: "left" | "right"
}

const EDGE = 8
const GAP = 6

/** Where a floating menu goes, flipping or clamping so it stays on screen. */
export function menuPosition({ anchor, menu, viewport, placement, align }: MenuPlacement): PanelPosition {
  if (placement === "right") {
    let left = anchor.right + EDGE
    if (left + menu.width > viewport.width - EDGE) left = anchor.left - menu.width - EDGE
    const top = Math.max(EDGE, Math.min(anchor.top, viewport.height - menu.height - EDGE))
    return { top, left: Math.max(EDGE, left) }
  }

  let top: number
  if (placement === "below") {
    top = anchor.bottom + GAP
    if (top + menu.height > viewport.height - EDGE) top = Math.max(EDGE, anchor.top - menu.height - GAP)
  } else {
    top = anchor.top - menu.height - GAP
    if (top < EDGE) top = anchor.bottom + GAP
  }
  const left = align === "right" ? anchor.right - menu.width : anchor.left
  return { top, left: Math.max(EDGE, Math.min(left, viewport.width - menu.width - EDGE)) }
}
