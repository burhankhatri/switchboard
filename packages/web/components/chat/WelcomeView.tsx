"use client"

import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { WorkspaceLauncher } from "@/components/workspaces/WorkspaceLauncher"

interface WelcomeViewProps {
  isMobile: boolean
  /** The composer input element, built by ChatPanel and shared with other views. */
  chatInput: ReactNode
  /** The file-preview modal element (or null), shared with other views. */
  filePreviewModal: ReactNode
}

/**
 * Home screen.
 *
 * When no workspace is selected the user is prompted to pick one from the
 * sidebar dropdown — the launcher list is no longer in the centre pane.
 * When a workspace is active the composer is centred as before.
 */
export function WelcomeView({
  isMobile,
  chatInput,
  filePreviewModal,
}: WelcomeViewProps) {
  const { activeWorkspace: active, setActiveWorkspace: setActive, ready } = useWorkspace()

  return (
    <>
      <div
        className={cn(
          "flex-1 flex flex-col bg-transparent backdrop-blur-xl relative overflow-y-auto",
          "items-center justify-center",
          isMobile ? "p-4 pb-safe" : "p-4"
        )}
      >

        {!ready ? null : active ? (
          /* ── Workspace active: centred composer ──
             Width must match ChatInput's own max-w-[52rem]. When the wrapper was
             narrower the composer overflowed its right edge while mx-auto held
             its left, which read as the whole block being shifted left. */
          <div className="w-full max-w-[52rem] mx-auto">
            <button
              onClick={() => setActive(null)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> All workspaces
            </button>
            <div className="text-center mb-6">
              <h2 className={cn("font-display tracking-tight", isMobile ? "text-xl" : "text-2xl")}>
                {active.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Its skills and scripts load automatically. Ask for the task.
              </p>
            </div>
            {chatInput}
            <p className="text-muted-foreground mt-4 text-center text-sm">
              Access tools with ⌘K.
            </p>
          </div>
        ) : (
          /* ── No workspace: the workspaces themselves ──
             This used to be a note pointing at the sidebar dropdown, which told
             you a control existed instead of showing you your workspaces. The
             launcher lists the ones you are in and the ones you can join, which
             is what someone who has just been added needs to see. */
          <WorkspaceLauncher onOpen={(w) => setActive(w)} />
        )}
      </div>
      {filePreviewModal}
    </>
  )
}

