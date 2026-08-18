"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface AnchoredMenuProps {
  /** The element the menu should hang off. */
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Which edge of the anchor to line the menu up with. */
  align?: "left" | "right"
  /** Menu width in px. Needed up front so right-alignment can be computed. */
  width?: number
  /** Take the anchor's width instead of a fixed one — for menus that belong to
   *  an input and should line up with it. */
  matchWidth?: boolean
  className?: string
}

/**
 * A menu that escapes its container.
 *
 * Every dropdown inside the composer was a plain `absolute` div, which meant it
 * was clipped twice over: the composer sets `backdrop-filter`, and an element
 * with a backdrop-filter clips its descendants to its own bounds regardless of
 * overflow — so a menu taller than the composer lost its top, and one wider
 * than the trigger lost its edges.
 *
 * Rendering into `document.body` and positioning from the trigger's bounding
 * rect sidesteps both. The cost is that the menu no longer moves with its
 * anchor for free, hence the reposition on scroll and resize.
 */
export function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  children,
  align = "left",
  width = 192,
  matchWidth = false,
  className,
}: AnchoredMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useLayoutEffect(() => {
    if (!open) return

    const place = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const height = menuRef.current?.offsetHeight ?? 0
      const w = matchWidth ? rect.width : width

      // Above the trigger by default — these hang off a composer pinned to the
      // bottom of the window, so below would run off-screen.
      let top = rect.top - height - 6
      if (top < 8) top = rect.bottom + 6

      let left = align === "right" ? rect.right - w : rect.left
      // Keep it on screen horizontally whichever edge it was aligned to.
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))

      setPos({ top, left, width: w })
    }

    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, align, width, matchWidth, anchorRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || !mounted) return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width ?? width,
        maxHeight: "min(60vh, 420px)",
        overflowY: "auto",
        // Hidden until placed, so it never flashes at the wrong position.
        visibility: pos ? "visible" : "hidden",
        animation: "pop-in 160ms var(--ease-spring) both",
      }}
      className={cn(
        "z-[100] rounded-[10px] bg-popover p-1 shadow-raised border border-line",
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
