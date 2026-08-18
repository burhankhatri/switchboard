"use client"

import type { ReactNode } from "react"
import { HelpCircle, Command, ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspaceLauncher } from "@/components/workspaces/WorkspaceLauncher"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { WorkspaceFileViewer } from "@/components/workspaces/WorkspaceFileViewer"

interface WelcomeViewProps {
  isMobile: boolean
  onOpenCommandPalette?: () => void
  onOpenHelp: () => void
  /** The composer input element, built by ChatPanel and shared with other views. */
  chatInput: ReactNode
  /** The file-preview modal element (or null), shared with other views. */
  filePreviewModal: ReactNode
}

/**
 * Home screen.
 *
 * Workspaces come first and the composer second, because the workspace decides
 * which skills, scripts and connections the run will have — asking "what would
 * you like to build?" before that is asking the question in the wrong order.
 */
export function WelcomeView({
  isMobile,
  onOpenCommandPalette,
  onOpenHelp,
  chatInput,
  filePreviewModal,
}: WelcomeViewProps) {
  // Shared with the sidebar: the same choice drives both panes.
  const { activeWorkspace: active, setActiveWorkspace: setActive, ready, openFile } = useWorkspace()

  return (
    <>
      <div
        className={cn(
          "flex-1 flex flex-col bg-transparent backdrop-blur-xl relative overflow-y-auto",
          active ? "items-center justify-center" : "",
          isMobile ? "p-4 pb-safe" : "p-4"
        )}
      >
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Commands"
              aria-label="Open commands"
            >
              <Command className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onOpenHelp}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Help"
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>

        {!ready ? null : openFile ? (
          <WorkspaceFileViewer />
        ) : active ? (
          <div className="w-full max-w-3xl mx-auto">
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
          <WorkspaceLauncher onOpen={setActive} />
        )}
      </div>
      {filePreviewModal}
    </>
  )
}
