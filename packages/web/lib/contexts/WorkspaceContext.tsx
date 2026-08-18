"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { WorkspaceFileUnsavedDialog } from "@/components/workspaces/WorkspaceFileUnsavedDialog"
import { clearDraft, isWorkspaceFileDirty } from "@/lib/workspace-file-cache"

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
  /**
   * Close the open file, prompting to save or discard when there are unsaved edits.
   * Returns true when the file is closed (or none was open); false when the user cancels.
   */
  closeOpenFile: () => Promise<boolean>
  /** Open a file, closing the current one first when it has unsaved edits. */
  requestOpenFile: (path: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const STORAGE_KEY = "switchboard.activeWorkspace"

/**
 * The active workspace id, read straight from storage.
 *
 * For callers outside React that cannot wait for the provider to hydrate — chat
 * materialisation runs from an event handler and must not write an unbound row
 * just because the context has not caught up yet.
 */
/** Forget the active workspace — used on sign-out. */
export function clearActiveWorkspace(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage disabled — nothing to clear */
  }
}

export function readActiveWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    return (JSON.parse(raw) as { id?: string }).id
  } catch {
    return undefined
  }
}

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
  const [openFile, setOpenFileState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [unsavedPrompt, setUnsavedPrompt] = useState<{ wsId: string; path: string } | null>(null)
  const closeResolverRef = useRef<((closed: boolean) => void) | null>(null)
  const closeInFlightRef = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setActive(JSON.parse(raw) as ActiveWorkspace)
    } catch {
      // A corrupt entry should not brick the app — start at the picker.
    }
    setReady(true)
  }, [])

  const finishClosePrompt = useCallback((closed: boolean) => {
    setUnsavedPrompt(null)
    closeInFlightRef.current = null
    const resolve = closeResolverRef.current
    closeResolverRef.current = null
    resolve?.(closed)
  }, [])

  const setOpenFile = useCallback((path: string | null) => {
    setOpenFileState(path)
  }, [])

  const closeOpenFile = useCallback((): Promise<boolean> => {
    if (closeInFlightRef.current) return closeInFlightRef.current
    if (!openFile || !activeWorkspace) return Promise.resolve(true)
    const wsId = activeWorkspace.id
    if (!isWorkspaceFileDirty(wsId, openFile)) {
      setOpenFileState(null)
      return Promise.resolve(true)
    }
    const pending = new Promise<boolean>((resolve) => {
      closeResolverRef.current = resolve
      setUnsavedPrompt({ wsId, path: openFile })
    })
    closeInFlightRef.current = pending
    return pending
  }, [openFile, activeWorkspace])

  const requestOpenFile = useCallback(
    async (path: string) => {
      if (openFile === path) return
      if (openFile) {
        const closed = await closeOpenFile()
        if (!closed) return
      }
      setOpenFileState(path)
    },
    [openFile, closeOpenFile]
  )

  const setActiveWorkspace = useMemo(
    () => (w: ActiveWorkspace | null) => {
      setActive(w)
      // Switching workspace must close the open file — its path belongs to the
      // workspace we just left and would 403 against the new one.
      setOpenFileState(null)
      try {
        if (w) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
        else window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Private-mode storage failures are not worth breaking navigation over.
      }
    },
    []
  )

  const handleUnsavedCancel = useCallback(() => {
    finishClosePrompt(false)
  }, [finishClosePrompt])

  const handleUnsavedDiscard = useCallback(() => {
    if (unsavedPrompt) {
      clearDraft(unsavedPrompt.wsId, unsavedPrompt.path)
    }
    setOpenFileState(null)
    finishClosePrompt(true)
  }, [unsavedPrompt, finishClosePrompt])

  const handleUnsavedSaved = useCallback(() => {
    setOpenFileState(null)
    finishClosePrompt(true)
  }, [finishClosePrompt])

  // Clicking outside the editor is the same as closing it: prompt if dirty,
  // otherwise return to the last chat. File-tree rows and the unsaved dialog
  // are excluded so they keep their own close/open handling.
  useEffect(() => {
    if (!openFile) return
    const onClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (
        target.closest(
          "[data-workspace-file-editor], [data-workspace-file], [data-workspace-file-unsaved]"
        )
      ) {
        return
      }
      void closeOpenFile()
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [openFile, closeOpenFile])

  const value = useMemo(
    () => ({
      activeWorkspace,
      setActiveWorkspace,
      ready,
      openFile,
      setOpenFile,
      closeOpenFile,
      requestOpenFile,
    }),
    [activeWorkspace, setActiveWorkspace, ready, openFile, setOpenFile, closeOpenFile, requestOpenFile]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {unsavedPrompt && (
        <WorkspaceFileUnsavedDialog
          open
          workspaceId={unsavedPrompt.wsId}
          path={unsavedPrompt.path}
          onCancel={handleUnsavedCancel}
          onDiscard={handleUnsavedDiscard}
          onSaved={handleUnsavedSaved}
        />
      )}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider")
  return ctx
}
