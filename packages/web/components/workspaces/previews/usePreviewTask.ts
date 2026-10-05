"use client"

import { useEffect, useState } from "react"

/**
 * Run one async step of a preview (parse, convert, load a font) and keep its
 * result or failure. Superseded runs are aborted so switching files quickly
 * never paints the previous file's preview into the new one.
 */
export function usePreviewTask<T>(task: (signal: AbortSignal) => Promise<T>, deps: unknown[]): { value?: T; error?: string } {
  const [state, setState] = useState<{ value?: T; error?: string }>({})
  useEffect(() => {
    const controller = new AbortController()
    setState({})
    task(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setState({ value }) },
      (err: unknown) => {
        if (!controller.signal.aborted) setState({ error: err instanceof Error ? err.message : "Could not preview this file" })
      }
    )
    return () => controller.abort()
    // The caller's deps fully determine the task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
