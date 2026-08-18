"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

export interface ActiveWorkspace {
  id: string
  slug: string
  name: string
  path: string
  agent: string
}

interface WorkspaceContextValue {
  activeWorkspace: ActiveWorkspace | null
  setActiveWorkspace: (w: ActiveWorkspace | null) => void
  /** False until localStorage has been read, so nothing flashes the wrong state. */
  ready: boolean
  /** Repo-relative path of the file being viewed, or null for the composer. */
  openFile: string | null
  setOpenFile: (path: string | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const STORAGE_KEY = "switchboard.activeWorkspace"

/**
 * Which workspace the user is currently working in.
 *
 * This is app-level rather than local to a view because the sidebar and the
 * main pane both depend on it: chat actions only make sense inside a workspace,
 * since a chat belongs to one. Persisted so a refresh puts you back where you
 * were instead of dumping you at the picker.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [activeWorkspace, setActive] = useState<ActiveWorkspace | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setActive(JSON.parse(raw) as ActiveWorkspace)
    } catch {
      // A corrupt entry should not brick the app — start at the picker.
    }
    setReady(true)
  }, [])

  const setActiveWorkspace = useMemo(
    () => (w: ActiveWorkspace | null) => {
      setActive(w)
      // Switching workspace must close the open file — its path belongs to the
      // workspace we just left and would 403 against the new one.
      setOpenFile(null)
      try {
        if (w) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
        else window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Private-mode storage failures are not worth breaking navigation over.
      }
    },
    []
  )

  const value = useMemo(
    () => ({ activeWorkspace, setActiveWorkspace, ready, openFile, setOpenFile }),
    [activeWorkspace, setActiveWorkspace, ready, openFile]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider")
  return ctx
}
