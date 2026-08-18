"use client"

import { useCallback, useEffect, useRef } from "react"
import { createShader, playSweep, accentChain, ACCENTS } from "glimm"

/**
 * A rainbow sweep across the composer when the model changes.
 *
 * Changing model is the one composer action with no visible result — the label
 * updates and nothing else does, so it is easy to be unsure whether it took.
 * The sweep is the acknowledgement.
 *
 * The built-in "prism" palette runs cyan → indigo → magenta, which reads as
 * blue-purple rather than a rainbow, so the full spectrum is built explicitly.
 */
const RAINBOW = accentChain([
  ACCENTS.red,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.green,
  ACCENTS.cyan,
  ACCENTS.blue,
  ACCENTS.purple,
])

export interface ModelSweepHandle {
  play: () => void
}

/**
 * Renders the canvas and returns a `play` callback. Invisible at rest, and
 * `pointer-events-none` so it never intercepts a click meant for the composer.
 *
 * The canvas needs explicit width/height as well as `inset-0`: a canvas is a
 * replaced element and will not stretch to its container from positioning
 * alone, and a zero-sized canvas feeds back into the shader's ResizeObserver.
 */
export function useModelSweep() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shaderRef = useRef<ReturnType<typeof createShader> | null>(null)
  const sweeping = useRef(false)

  /**
   * `createShader` seeds its hue phase from `Math.random()`, so the sweep came
   * out a different colour on every reload. Pinning the source of randomness
   * for the duration of construction makes it identical every time.
   */
  const makeShader = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const random = Math.random
    Math.random = () => 0
    try {
      return createShader({
        canvas,
        palette: RAINBOW,
        direction: "ltr",
        bandTight: 10,
        swellAmount: 0.85,
      })
    } finally {
      Math.random = random
    }
  }, [])

  useEffect(() => {
    shaderRef.current = makeShader()
    return () => {
      shaderRef.current?.destroy()
      shaderRef.current = null
    }
  }, [makeShader])

  const play = useCallback(() => {
    if (sweeping.current) return
    if (typeof window === "undefined") return
    // Honour the same preference the CSS animations do. This one is canvas, so
    // the global reduced-motion rule cannot reach it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // Rebuilt per sweep so uTime restarts at zero — the hue drifts with time, so
    // reusing the shader would make each sweep a slightly different colour.
    shaderRef.current?.destroy()
    const shader = makeShader()
    shaderRef.current = shader
    if (!shader) return

    sweeping.current = true
    playSweep(shader, {
      palette: RAINBOW,
      direction: "ltr",
      sweepMs: 570,
      outroMs: 80,
      peakAlpha: 1.3,
      bandTight: 10,
      brightness: 1.4,
      swellAmount: 1,
      waveSpeed: 1.8,
      easing: "easeOutExpo",
    }).done.finally(() => {
      sweeping.current = false
    })
  }, [makeShader])

  const canvas = (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      style={{ borderRadius: "inherit" }}
    />
  )

  return { canvas, play }
}
