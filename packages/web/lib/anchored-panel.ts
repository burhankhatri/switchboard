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
